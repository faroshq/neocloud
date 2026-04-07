/*
Copyright 2026 The KCP Reference Architecture Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package virtualmachines

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"text/template"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/klog/v2"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	commonv1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/common/v1alpha1"
	computev1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/compute/v1alpha1"

	mcbuilder "sigs.k8s.io/multicluster-runtime/pkg/builder"
	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
	mcreconcile "sigs.k8s.io/multicluster-runtime/pkg/reconcile"
)

var (
	kubevirtVMGVR = schema.GroupVersionResource{
		Group:    "kubevirt.io",
		Version:  "v1",
		Resource: "virtualmachines",
	}
	kubevirtVMIGVR = schema.GroupVersionResource{
		Group:    "kubevirt.io",
		Version:  "v1",
		Resource: "virtualmachineinstances",
	}
)

// imageMap maps our platform image names to KubeVirt containerDisk images.
// Ubuntu images use custom builds with fixed /etc/fstab (nofail on UEFI mount).
// See project/platform/images/containerdisks/CONTAINERDISKS.md for details.
var imageMap = map[string]string{
	"ubuntu-22.04": "ghcr.io/mjudeikis/containerdisks/ubuntu:22.04",
	"ubuntu-24.04": "ghcr.io/mjudeikis/containerdisks/ubuntu:24.04",
	"debian-12":    "quay.io/containerdisks/debian:12",
	"debian-13":    "quay.io/containerdisks/debian:13",
}

// defaultNamespace is the namespace where KubeVirt VMs are created on the workload cluster.
const defaultNamespace = "default"

// finalizerName is the finalizer added to platform VMs to ensure KubeVirt cleanup.
const finalizerName = "compute.cloud.platform/kubevirt-cleanup"

// Reconciler reconciles VirtualMachine resources.
type Reconciler struct {
	mgr            mcmanager.Manager
	workloadClient dynamic.Interface // nil = mock mode
}

// SetupWithManager registers the VirtualMachine controller with the multicluster manager.
func SetupWithManager(mgr mcmanager.Manager, workloadClient dynamic.Interface) error {
	r := &Reconciler{mgr: mgr, workloadClient: workloadClient}

	if workloadClient != nil {
		klog.Info("Registering VirtualMachine controller (workload cluster mode)")
	} else {
		klog.Info("Registering VirtualMachine controller (mock mode)")
	}

	if err := mcbuilder.ControllerManagedBy(mgr).
		Named("virtualmachine").
		For(&computev1alpha1.VirtualMachine{}).
		Complete(r); err != nil {
		return fmt.Errorf("setting up VirtualMachine controller: %w", err)
	}

	return nil
}

// Reconcile handles VirtualMachine reconciliation.
func (r *Reconciler) Reconcile(ctx context.Context, req mcreconcile.Request) (ctrl.Result, error) {
	logger := klog.FromContext(ctx).WithValues("vm", req.NamespacedName, "cluster", req.ClusterName)
	logger.Info("Reconciling VirtualMachine")

	cl, err := r.mgr.GetCluster(ctx, req.ClusterName)
	if err != nil {
		return ctrl.Result{}, fmt.Errorf("getting cluster %s: %w", req.ClusterName, err)
	}
	c := cl.GetClient()

	var vm computev1alpha1.VirtualMachine
	if err := c.Get(ctx, req.NamespacedName, &vm); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// Handle deletion.
	if vm.DeletionTimestamp != nil {
		return r.handleDeletion(ctx, c, &vm, logger)
	}

	// Ensure finalizer is present so we can clean up KubeVirt resources on deletion.
	if !controllerutil.ContainsFinalizer(&vm, finalizerName) {
		controllerutil.AddFinalizer(&vm, finalizerName)
		if err := c.Update(ctx, &vm); err != nil {
			return ctrl.Result{}, fmt.Errorf("adding finalizer: %w", err)
		}
	}

	switch vm.Status.Phase {
	case "", computev1alpha1.VirtualMachinePending:
		return r.handlePending(ctx, c, &vm, logger)
	case computev1alpha1.VirtualMachineProvisioning:
		return r.handleProvisioning(ctx, c, &vm, logger)
	case computev1alpha1.VirtualMachineRunning:
		return r.handleRunning(ctx, c, &vm, logger)
	case computev1alpha1.VirtualMachineFailed:
		return r.handleFailed(ctx, c, &vm, logger)
	default:
		logger.Info("VM in terminal state", "phase", vm.Status.Phase)
		return ctrl.Result{}, nil
	}
}

// handleFailed attempts to recover a failed VM by cleaning up stale resources and resetting to Pending.
func (r *Reconciler) handleFailed(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	kvName := kubevirtVMName(vm)
	logger.Info("VM in Failed state, attempting recovery", "kubevirtName", kvName)

	// Clean up any stale KubeVirt VM on the workload cluster.
	if r.workloadClient != nil {
		err := r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Delete(ctx, kvName, metav1.DeleteOptions{})
		if err != nil {
			logger.Info("Stale KubeVirt VM cleanup (may already be gone)", "error", err)
		}
	}

	// Reset to Pending so handlePending will recreate the VM.
	vm.Status.Phase = computev1alpha1.VirtualMachinePending
	vm.Status.Message = "Recovering from failure, will recreate"
	vm.Status.InternalIP = ""
	setCondition(&vm.Status.Conditions, metav1.Condition{
		Type:               commonv1alpha1.ConditionProgessing,
		Status:             metav1.ConditionTrue,
		Reason:             "Recovering",
		Message:            "Resetting VM to Pending after failure",
		LastTransitionTime: metav1.Now(),
	})

	if err := c.Status().Update(ctx, vm); err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
}

// handleDeletion cleans up the KubeVirt VM on the workload cluster and removes the finalizer.
// It waits for the KubeVirt VM to be fully gone before removing the finalizer.
func (r *Reconciler) handleDeletion(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	if !controllerutil.ContainsFinalizer(vm, finalizerName) {
		return ctrl.Result{}, nil
	}

	kvName := kubevirtVMName(vm)
	logger.Info("VM deleted, cleaning up KubeVirt VM", "kubevirtName", kvName)

	if r.workloadClient != nil {
		// Check if the KubeVirt VM still exists.
		_, err := r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Get(ctx, kvName, metav1.GetOptions{})
		if err == nil {
			// VM still exists — issue a delete and requeue to wait for it to be gone.
			delErr := r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Delete(ctx, kvName, metav1.DeleteOptions{})
			if delErr != nil && !apierrors.IsNotFound(delErr) {
				logger.Error(delErr, "Failed to delete KubeVirt VM")
			}

			// Update status to reflect termination in progress.
			if vm.Status.Phase != computev1alpha1.VirtualMachineTerminating {
				vm.Status.Phase = computev1alpha1.VirtualMachineTerminating
				vm.Status.Message = "VirtualMachine is being terminated"
				setCondition(&vm.Status.Conditions, metav1.Condition{
					Type:               commonv1alpha1.ConditionAvailable,
					Status:             metav1.ConditionFalse,
					Reason:             "Terminating",
					Message:            "VirtualMachine is being deleted",
					LastTransitionTime: metav1.Now(),
				})
				setCondition(&vm.Status.Conditions, metav1.Condition{
					Type:               commonv1alpha1.ConditionProgessing,
					Status:             metav1.ConditionTrue,
					Reason:             "Terminating",
					Message:            "Waiting for VirtualMachine resources to be cleaned up",
					LastTransitionTime: metav1.Now(),
				})
				_ = c.Status().Update(ctx, vm)
			}

			logger.Info("Waiting for KubeVirt VM to be fully deleted", "kubevirtName", kvName)
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		} else if !apierrors.IsNotFound(err) {
			// Transient error checking the VM — requeue.
			logger.Info("Failed to check KubeVirt VM during deletion, requeueing", "error", err)
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		}
		// IsNotFound — VM is gone, safe to remove finalizer.
		logger.Info("KubeVirt VM is fully deleted", "kubevirtName", kvName)
	}

	controllerutil.RemoveFinalizer(vm, finalizerName)
	if err := c.Update(ctx, vm); err != nil {
		return ctrl.Result{}, fmt.Errorf("removing finalizer: %w", err)
	}

	return ctrl.Result{}, nil
}

// handlePending creates the KubeVirt VM on the workload cluster and transitions to Provisioning.
func (r *Reconciler) handlePending(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	kvName := kubevirtVMName(vm)

	if r.workloadClient != nil {
		// Resolve root password if EnableRootLogin is set.
		if err := resolveRootPassword(ctx, c, vm, logger); err != nil {
			logger.Error(err, "Failed to resolve root password")
			vm.Status.Phase = computev1alpha1.VirtualMachineFailed
			vm.Status.Message = fmt.Sprintf("Failed to resolve root password: %v", err)
			_ = c.Status().Update(ctx, vm)
			return ctrl.Result{}, err
		}

		// Resolve cloud-init user-data from the reference (or default).
		userData, err := resolveCloudInitUserData(ctx, c, vm, kvName)
		if err != nil {
			logger.Error(err, "Failed to resolve cloud-init user-data")
			vm.Status.Phase = computev1alpha1.VirtualMachineFailed
			vm.Status.Message = fmt.Sprintf("Failed to resolve cloud-init: %v", err)
			_ = c.Status().Update(ctx, vm)
			return ctrl.Result{}, err
		}

		// Build and create the KubeVirt VirtualMachine on the workload cluster.
		kvVM := buildKubeVirtVM(kvName, vm, userData)
		logger.Info("Creating KubeVirt VM on workload cluster", "kubevirtName", kvName)

		_, err = r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Create(ctx, kvVM, metav1.CreateOptions{})
		if err != nil {
			logger.Error(err, "Failed to create KubeVirt VM")
			vm.Status.Phase = computev1alpha1.VirtualMachineFailed
			vm.Status.Message = fmt.Sprintf("Failed to create VirtualMachine: %v", err)
			_ = c.Status().Update(ctx, vm)
			return ctrl.Result{}, err
		}
	} else {
		logger.Info("[mock] Would create KubeVirt VM", "kubevirtName", kvName)
	}

	vm.Status.Phase = computev1alpha1.VirtualMachineProvisioning
	vm.Status.Message = "VirtualMachine created, waiting for scheduling"
	setCondition(&vm.Status.Conditions, metav1.Condition{
		Type:               commonv1alpha1.ConditionProgessing,
		Status:             metav1.ConditionTrue,
		Reason:             "VMCreated",
		Message:            "VirtualMachine created, provisioning in progress",
		LastTransitionTime: metav1.Now(),
	})

	if err := c.Status().Update(ctx, vm); err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
}

// provisioningTimeout is the maximum time a VM can stay in Provisioning before being marked Failed.
const provisioningTimeout = 10 * time.Minute

// isProvisioningTimedOut checks if the VM has been in Provisioning state longer than the timeout.
// It uses the Progressing condition's LastTransitionTime as the provisioning start time.
func (r *Reconciler) isProvisioningTimedOut(vm *computev1alpha1.VirtualMachine) bool {
	for _, cond := range vm.Status.Conditions {
		if cond.Type == commonv1alpha1.ConditionProgessing && cond.Status == metav1.ConditionTrue {
			return time.Since(cond.LastTransitionTime.Time) > provisioningTimeout
		}
	}
	return false
}

// handleProvisioning checks whether the KubeVirt VMI is running and transitions to Running.
func (r *Reconciler) handleProvisioning(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	kvName := kubevirtVMName(vm)

	// Check if provisioning has been stuck too long.
	if r.isProvisioningTimedOut(vm) {
		logger.Info("Provisioning timed out, marking as Failed", "timeout", provisioningTimeout)
		vm.Status.Phase = computev1alpha1.VirtualMachineFailed
		vm.Status.Message = fmt.Sprintf("Provisioning timed out after %s", provisioningTimeout)
		setCondition(&vm.Status.Conditions, metav1.Condition{
			Type:               commonv1alpha1.ConditionProgessing,
			Status:             metav1.ConditionFalse,
			Reason:             "ProvisioningTimeout",
			Message:            fmt.Sprintf("VM did not become ready within %s", provisioningTimeout),
			LastTransitionTime: metav1.Now(),
		})
		if err := c.Status().Update(ctx, vm); err != nil {
			return ctrl.Result{}, err
		}
		return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
	}

	var internalIP string
	var isRunning bool

	if r.workloadClient != nil {
		// Check if the KubeVirt VM itself still exists on the workload cluster.
		_, err := r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Get(ctx, kvName, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			logger.Info("KubeVirt VM disappeared during provisioning, marking as Failed", "kubevirtName", kvName)
			vm.Status.Phase = computev1alpha1.VirtualMachineFailed
			vm.Status.Message = "VirtualMachine disappeared during provisioning"
			setCondition(&vm.Status.Conditions, metav1.Condition{
				Type:               commonv1alpha1.ConditionProgessing,
				Status:             metav1.ConditionFalse,
				Reason:             "VMDisappeared",
				Message:            "VirtualMachine no longer exists",
				LastTransitionTime: metav1.Now(),
			})
			if err := c.Status().Update(ctx, vm); err != nil {
				return ctrl.Result{}, err
			}
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		} else if err != nil {
			logger.Info("Failed to check KubeVirt VM, requeueing", "error", err)
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		}

		// Check VMI status on the workload cluster.
		vmi, err := r.workloadClient.Resource(kubevirtVMIGVR).Namespace(defaultNamespace).Get(ctx, kvName, metav1.GetOptions{})
		if err != nil {
			logger.Info("VMI not ready yet, requeueing", "error", err)
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		}

		// Check if VMI phase is Running.
		phase, _, _ := unstructured.NestedString(vmi.Object, "status", "phase")
		if phase != "Running" {
			logger.Info("VMI not running yet", "phase", phase)
			return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
		}

		// Extract IP from VMI status.
		interfaces, found, _ := unstructured.NestedSlice(vmi.Object, "status", "interfaces")
		if found && len(interfaces) > 0 {
			if iface, ok := interfaces[0].(map[string]interface{}); ok {
				if ip, ok := iface["ipAddress"].(string); ok {
					internalIP = ip
				}
			}
		}
		isRunning = true
	} else {
		// Mock mode: simulate running after one requeue cycle.
		internalIP = "10.244.1.42"
		isRunning = true
	}

	if !isRunning {
		return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
	}

	vm.Status.Phase = computev1alpha1.VirtualMachineRunning
	vm.Status.Message = "VirtualMachine is running"
	vm.Status.InternalIP = internalIP
	if internalIP != "" {
		vm.Status.SSHEndpoint = fmt.Sprintf("%s:22", internalIP)
	}

	setCondition(&vm.Status.Conditions, metav1.Condition{
		Type:               commonv1alpha1.ConditionAvailable,
		Status:             metav1.ConditionTrue,
		Reason:             "VMIRunning",
		Message:            "VirtualMachine instance is running",
		LastTransitionTime: metav1.Now(),
	})
	setCondition(&vm.Status.Conditions, metav1.Condition{
		Type:               commonv1alpha1.ConditionProgessing,
		Status:             metav1.ConditionFalse,
		Reason:             "VMIRunning",
		Message:            "Provisioning complete",
		LastTransitionTime: metav1.Now(),
	})

	if err := c.Status().Update(ctx, vm); err != nil {
		return ctrl.Result{}, err
	}

	logger.Info("VM is now running", "internalIP", internalIP)
	return ctrl.Result{}, nil
}

// handleRunning periodically syncs the VM status from the workload cluster.
func (r *Reconciler) handleRunning(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	if r.workloadClient == nil {
		return ctrl.Result{}, nil
	}

	kvName := kubevirtVMName(vm)
	vmi, err := r.workloadClient.Resource(kubevirtVMIGVR).Namespace(defaultNamespace).Get(ctx, kvName, metav1.GetOptions{})
	if err != nil {
		logger.Info("VMI not found for running VM, may have been stopped", "error", err)
		vm.Status.Phase = computev1alpha1.VirtualMachineFailed
		vm.Status.Message = "VirtualMachine instance disappeared"
		setCondition(&vm.Status.Conditions, metav1.Condition{
			Type:               commonv1alpha1.ConditionAvailable,
			Status:             metav1.ConditionFalse,
			Reason:             "VMINotFound",
			Message:            "VirtualMachine instance not found",
			LastTransitionTime: metav1.Now(),
		})
		_ = c.Status().Update(ctx, vm)
		return ctrl.Result{}, nil
	}

	// Sync IP from VMI.
	interfaces, found, _ := unstructured.NestedSlice(vmi.Object, "status", "interfaces")
	if found && len(interfaces) > 0 {
		if iface, ok := interfaces[0].(map[string]interface{}); ok {
			if ip, ok := iface["ipAddress"].(string); ok {
				if ip != vm.Status.InternalIP {
					vm.Status.InternalIP = ip
					_ = c.Status().Update(ctx, vm)
				}
			}
		}
	}

	return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}

// kubevirtVMName generates a deterministic name for the KubeVirt VM from the platform VM.
func kubevirtVMName(vm *computev1alpha1.VirtualMachine) string {
	// Use the UID to avoid name collisions across kcp workspaces.
	return fmt.Sprintf("platform-%s", strings.ToLower(string(vm.UID)[:8]))
}

// cloudInitCategoryMap maps image categories to default PublicCloudInit names.
var cloudInitCategoryMap = map[string]string{
	"ubuntu":   "debian",
	"debian":   "debian",
	"fedora":   "redhat",
	"centos":   "redhat",
	"opensuse": "opensuse",
}

// cloudInitTemplateData holds the variables available in cloud-init templates.
type cloudInitTemplateData struct {
	Hostname        string
	SSHPublicKey    string
	EnableRootLogin bool
	RootPassword    string
}

// generatePassword generates a random password of the given byte length, hex-encoded.
func generatePassword(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// resolveRootPassword ensures a root password Secret exists when EnableRootLogin is true.
// If spec.ssh.rootPasswordSecret is set, it reads the password from that Secret.
// Otherwise, it generates a random password, creates a Secret, and records it in status.
// The Secret is created in the user's KCP workspace via the multicluster client (requires
// secrets permission claim on the APIExport).
func resolveRootPassword(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) error {
	if vm.Spec.SSH == nil || !vm.Spec.SSH.EnableRootLogin {
		return nil
	}

	// If the user provided a secret reference, just validate it exists.
	if vm.Spec.SSH.RootPasswordSecret != nil {
		var secret unstructured.Unstructured
		secret.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
		ref := vm.Spec.SSH.RootPasswordSecret
		if err := c.Get(ctx, client.ObjectKey{Name: ref.Name, Namespace: ref.Namespace}, &secret); err != nil {
			return fmt.Errorf("getting root password Secret %s/%s: %w", ref.Namespace, ref.Name, err)
		}
		// Record in status so it's discoverable.
		vm.Status.RootPasswordSecret = vm.Spec.SSH.RootPasswordSecret
		return nil
	}

	// Already generated in a previous reconcile.
	if vm.Status.RootPasswordSecret != nil {
		return nil
	}

	// Generate a random password and create a Secret.
	password, err := generatePassword(16)
	if err != nil {
		return fmt.Errorf("generating root password: %w", err)
	}

	secretName := fmt.Sprintf("%s-root-password", vm.Name)
	secretNamespace := "default"

	secret := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Secret",
			"metadata": map[string]interface{}{
				"name":      secretName,
				"namespace": secretNamespace,
			},
			"type": "Opaque",
			"stringData": map[string]interface{}{
				"password": password,
			},
		},
	}

	if err := c.Create(ctx, secret); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("creating root password Secret: %w", err)
		}
		// Already exists (e.g. from a previous failed reconcile before status was updated).
		logger.Info("Root password Secret already exists", "name", secretName)
	} else {
		logger.Info("Created root password Secret", "name", secretName)
	}

	vm.Status.RootPasswordSecret = &computev1alpha1.SecretReference{
		Name:      secretName,
		Namespace: secretNamespace,
	}

	return nil
}

// getRootPassword reads the root password from the Secret referenced in status.
func getRootPassword(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine) (string, error) {
	ref := vm.Status.RootPasswordSecret
	if ref == nil {
		// Check spec as well.
		if vm.Spec.SSH != nil && vm.Spec.SSH.RootPasswordSecret != nil {
			ref = vm.Spec.SSH.RootPasswordSecret
		}
	}
	if ref == nil {
		return "", nil
	}

	var secret unstructured.Unstructured
	secret.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
	if err := c.Get(ctx, client.ObjectKey{Name: ref.Name, Namespace: ref.Namespace}, &secret); err != nil {
		return "", fmt.Errorf("getting root password Secret %s/%s: %w", ref.Namespace, ref.Name, err)
	}

	// Try stringData first (newly created), then data (base64-encoded by Kubernetes).
	if pw, ok, _ := unstructured.NestedString(secret.Object, "stringData", "password"); ok && pw != "" {
		return pw, nil
	}
	if pw, ok, _ := unstructured.NestedString(secret.Object, "data", "password"); ok && pw != "" {
		decoded, err := base64.StdEncoding.DecodeString(pw)
		if err != nil {
			return "", fmt.Errorf("decoding base64 password from Secret %s/%s: %w", ref.Namespace, ref.Name, err)
		}
		return string(decoded), nil
	}

	return "", fmt.Errorf("root password Secret %s/%s does not contain 'password' key", ref.Namespace, ref.Name)
}

// resolveCloudInitUserData resolves the cloud-init user-data for a VM.
// It checks the VM's CloudInit reference (PublicCloudInit, CloudInit, or Secret),
// falls back to a default PublicCloudInit based on the disk image, and renders
// the Go template with VM-specific variables.
func resolveCloudInitUserData(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, hostname string) (string, error) {
	var userDataTemplate string

	if vm.Spec.CloudInit != nil {
		ref := vm.Spec.CloudInit

		switch {
		case ref.PublicCloudInit != "":
			var pci computev1alpha1.PublicCloudInit
			if err := c.Get(ctx, client.ObjectKey{Name: ref.PublicCloudInit}, &pci); err != nil {
				return "", fmt.Errorf("getting PublicCloudInit %q: %w", ref.PublicCloudInit, err)
			}
			userDataTemplate = pci.Spec.UserData

		case ref.CloudInit != "":
			var ci computev1alpha1.CloudInit
			if err := c.Get(ctx, client.ObjectKey{Name: ref.CloudInit}, &ci); err != nil {
				return "", fmt.Errorf("getting CloudInit %q: %w", ref.CloudInit, err)
			}
			userDataTemplate = ci.Spec.UserData

		case ref.Secret != nil:
			var secret unstructured.Unstructured
			secret.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "Secret"})
			if err := c.Get(ctx, client.ObjectKey{Name: ref.Secret.Name, Namespace: ref.Secret.Namespace}, &secret); err != nil {
				return "", fmt.Errorf("getting Secret %s/%s: %w", ref.Secret.Namespace, ref.Secret.Name, err)
			}
			data, ok, _ := unstructured.NestedString(secret.Object, "data", "userData")
			if !ok {
				// Try stringData for unencoded secrets.
				data, ok, _ = unstructured.NestedString(secret.Object, "stringData", "userData")
			}
			if !ok || data == "" {
				return "", fmt.Errorf("Secret %s/%s does not contain 'userData' key", ref.Secret.Namespace, ref.Secret.Name)
			}
			userDataTemplate = data
		}
	}

	// Fall back to default PublicCloudInit based on image category.
	if userDataTemplate == "" {
		defaultName := "debian" // safe default
		// Try to match image name to a category.
		for prefix, ciName := range cloudInitCategoryMap {
			if strings.Contains(vm.Spec.Disk.Image, prefix) {
				defaultName = ciName
				break
			}
		}

		var pci computev1alpha1.PublicCloudInit
		if err := c.Get(ctx, client.ObjectKey{Name: defaultName}, &pci); err != nil {
			return "", fmt.Errorf("getting default PublicCloudInit %q: %w", defaultName, err)
		}
		userDataTemplate = pci.Spec.UserData
	}

	return renderCloudInitTemplate(ctx, c, userDataTemplate, hostname, vm)
}

// renderCloudInitTemplate executes a cloud-init template with VM-specific variables.
func renderCloudInitTemplate(ctx context.Context, c client.Client, tmplStr, hostname string, vm *computev1alpha1.VirtualMachine) (string, error) {
	data := cloudInitTemplateData{
		Hostname: hostname,
	}
	if vm.Spec.SSH != nil {
		data.SSHPublicKey = vm.Spec.SSH.PublicKey
		data.EnableRootLogin = vm.Spec.SSH.EnableRootLogin
	}

	// Resolve root password from Secret if EnableRootLogin is set.
	if data.EnableRootLogin {
		pw, err := getRootPassword(ctx, c, vm)
		if err != nil {
			return "", fmt.Errorf("resolving root password: %w", err)
		}
		data.RootPassword = pw
	}

	tmpl, err := template.New("cloudinit").Parse(tmplStr)
	if err != nil {
		return "", fmt.Errorf("parsing cloud-init template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("rendering cloud-init template: %w", err)
	}

	return buf.String(), nil
}

// buildKubeVirtVM constructs an unstructured KubeVirt VirtualMachine object.
func buildKubeVirtVM(name string, vm *computev1alpha1.VirtualMachine, userData string) *unstructured.Unstructured {
	containerDiskImage := imageMap[vm.Spec.Disk.Image]
	if containerDiskImage == "" {
		containerDiskImage = "ghcr.io/mjudeikis/containerdisks/ubuntu:22.04"
	}

	// Build volumes list.
	volumes := []interface{}{
		map[string]interface{}{
			"name": "containerdisk",
			"containerDisk": map[string]interface{}{
				"image": containerDiskImage,
			},
		},
		map[string]interface{}{
			"name": "cloudinitdisk",
			"cloudInitNoCloud": map[string]interface{}{
				"userData": userData,
			},
		},
	}

	// Build disks list.
	disks := []interface{}{
		map[string]interface{}{
			"name": "containerdisk",
			"disk": map[string]interface{}{
				"bus": "virtio",
			},
		},
		map[string]interface{}{
			"name": "cloudinitdisk",
			"disk": map[string]interface{}{
				"bus": "virtio",
			},
		},
	}

	// Build devices.
	devices := map[string]interface{}{
		"disks": disks,
		"interfaces": []interface{}{
			map[string]interface{}{
				"name":       "default",
				"masquerade": map[string]interface{}{},
				"ports": []interface{}{
					map[string]interface{}{
						"name":     "ssh",
						"port":     int64(22),
						"protocol": "TCP",
					},
				},
			},
		},
	}

	// Add GPU passthrough if requested.
	if vm.Spec.GPU != nil && vm.Spec.GPU.Count > 0 {
		gpus := make([]interface{}, vm.Spec.GPU.Count)
		for i := 0; i < vm.Spec.GPU.Count; i++ {
			gpus[i] = map[string]interface{}{
				"name":       fmt.Sprintf("gpu-%d", i),
				"deviceName": "nvidia.com/gpu",
			}
		}
		devices["gpus"] = gpus
	}

	kvVM := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "kubevirt.io/v1",
			"kind":       "VirtualMachine",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": defaultNamespace,
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "neocloud-platform",
					"platform.neocloud.dev/vm-uid": string(vm.UID),
				},
			},
			"spec": map[string]interface{}{
				"runStrategy": "Always",
				"template": map[string]interface{}{
					"metadata": map[string]interface{}{
						"labels": map[string]interface{}{
							"kubevirt.io/vm": name,
						},
					},
					"spec": map[string]interface{}{
						"domain": map[string]interface{}{
							"resources": map[string]interface{}{
								"requests": map[string]interface{}{
									"memory": vm.Spec.Memory,
									"cpu":    fmt.Sprintf("%d", vm.Spec.Cores),
								},
								"limits": map[string]interface{}{
									"memory": vm.Spec.Memory,
									"cpu":    fmt.Sprintf("%d", vm.Spec.Cores),
								},
							},
							"devices": devices,
						},
						"networks": []interface{}{
							map[string]interface{}{
								"name": "default",
								"pod":  map[string]interface{}{},
							},
						},
						"volumes": volumes,
					},
				},
			},
		},
	}

	return kvVM
}

// setCondition sets a condition on the list, returning true if the condition was changed.
func setCondition(conditions *[]metav1.Condition, condition metav1.Condition) bool {
	for i, existing := range *conditions {
		if existing.Type == condition.Type {
			if existing.Status == condition.Status && existing.Reason == condition.Reason {
				return false
			}
			(*conditions)[i] = condition
			return true
		}
	}
	*conditions = append(*conditions, condition)
	return true
}
