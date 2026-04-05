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
	"context"
	"fmt"
	"strings"
	"time"

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
var imageMap = map[string]string{
	"ubuntu-22.04": "quay.io/containerdisks/ubuntu:22.04",
	"ubuntu-24.04": "quay.io/containerdisks/ubuntu:24.04",
	"debian-12":    "quay.io/containerdisks/debian:12",
	"flatcar":      "quay.io/containerdisks/flatcar",
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
func (r *Reconciler) handleDeletion(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	if !controllerutil.ContainsFinalizer(vm, finalizerName) {
		return ctrl.Result{}, nil
	}

	kvName := kubevirtVMName(vm)
	logger.Info("VM deleted, cleaning up KubeVirt VM", "kubevirtName", kvName)

	if r.workloadClient != nil {
		err := r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Delete(ctx, kvName, metav1.DeleteOptions{})
		if err != nil {
			logger.Info("KubeVirt VM deletion (may already be gone)", "error", err)
		}
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
		// Build and create the KubeVirt VirtualMachine on the workload cluster.
		kvVM := buildKubeVirtVM(kvName, vm)
		logger.Info("Creating KubeVirt VM on workload cluster", "kubevirtName", kvName)

		_, err := r.workloadClient.Resource(kubevirtVMGVR).Namespace(defaultNamespace).Create(ctx, kvVM, metav1.CreateOptions{})
		if err != nil {
			logger.Error(err, "Failed to create KubeVirt VM")
			vm.Status.Phase = computev1alpha1.VirtualMachineFailed
			vm.Status.Message = fmt.Sprintf("Failed to create KubeVirt VM: %v", err)
			_ = c.Status().Update(ctx, vm)
			return ctrl.Result{}, err
		}
	} else {
		logger.Info("[mock] Would create KubeVirt VM", "kubevirtName", kvName)
	}

	vm.Status.Phase = computev1alpha1.VirtualMachineProvisioning
	vm.Status.Message = "KubeVirt VM created, waiting for scheduling"
	setCondition(&vm.Status.Conditions, metav1.Condition{
		Type:               commonv1alpha1.ConditionProgessing,
		Status:             metav1.ConditionTrue,
		Reason:             "VMCreated",
		Message:            "KubeVirt VirtualMachine created on workload cluster",
		LastTransitionTime: metav1.Now(),
	})

	if err := c.Status().Update(ctx, vm); err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
}

// handleProvisioning checks whether the KubeVirt VMI is running and transitions to Running.
func (r *Reconciler) handleProvisioning(ctx context.Context, c client.Client, vm *computev1alpha1.VirtualMachine, logger klog.Logger) (ctrl.Result, error) {
	kvName := kubevirtVMName(vm)

	var internalIP string
	var isRunning bool

	if r.workloadClient != nil {
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
		Message:            "KubeVirt VirtualMachineInstance is running",
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
		vm.Status.Message = "KubeVirt VMI disappeared"
		setCondition(&vm.Status.Conditions, metav1.Condition{
			Type:               commonv1alpha1.ConditionAvailable,
			Status:             metav1.ConditionFalse,
			Reason:             "VMINotFound",
			Message:            "KubeVirt VirtualMachineInstance not found",
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

// buildKubeVirtVM constructs an unstructured KubeVirt VirtualMachine object.
func buildKubeVirtVM(name string, vm *computev1alpha1.VirtualMachine) *unstructured.Unstructured {
	containerDiskImage := imageMap[vm.Spec.Disk.Image]
	if containerDiskImage == "" {
		containerDiskImage = "quay.io/containerdisks/ubuntu:24.04"
	}

	// Build cloud-init userdata.
	userData := "#cloud-config\nhostname: " + name + "\n"
	if vm.Spec.SSH != nil && vm.Spec.SSH.PublicKey != "" {
		userData += "ssh_authorized_keys:\n  - " + vm.Spec.SSH.PublicKey + "\n"
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
