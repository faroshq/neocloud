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

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	commonv1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/common/v1alpha1"
)

// VirtualMachineSpec defines the desired state of VirtualMachine.
type VirtualMachineSpec struct {
	// Number of virtual CPU cores (1-64).
	// +required
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=64
	Cores int `json:"cores"`

	// Amount of memory in Kubernetes resource format (e.g. "4Gi").
	// +required
	Memory string `json:"memory"`

	// Root disk configuration.
	// +required
	Disk VirtualMachineDisk `json:"disk"`

	// Optional GPU configuration.
	// +optional
	GPU *VirtualMachineGPU `json:"gpu,omitempty"`

	// SSH access configuration.
	// +optional
	SSH *VirtualMachineSSH `json:"ssh,omitempty"`

	// CloudInit configuration reference. Exactly one of the fields must be set.
	// If not specified, a default cloud-init matching the disk image category is used.
	// +optional
	CloudInit *CloudInitReference `json:"cloudInit,omitempty"`
}

// CloudInitReference specifies where to obtain cloud-init user-data.
// Exactly one of the fields must be set.
type CloudInitReference struct {
	// Reference to a PublicCloudInit resource by name.
	// +optional
	PublicCloudInit string `json:"publicCloudInit,omitempty"`

	// Reference to a CloudInit resource by name (user-owned, cluster-scoped).
	// +optional
	CloudInit string `json:"cloudInit,omitempty"`

	// Reference to a Secret containing cloud-init user-data in the "userData" key.
	// +optional
	Secret *SecretReference `json:"secret,omitempty"`
}

// SecretReference identifies a Secret by name and namespace.
type SecretReference struct {
	// Name of the Secret.
	// +required
	Name string `json:"name"`

	// Namespace of the Secret.
	// +required
	Namespace string `json:"namespace"`
}

// VirtualMachineDisk defines the root disk for a VirtualMachine.
type VirtualMachineDisk struct {
	// Size of the root disk (e.g. "50Gi").
	// +required
	Size string `json:"size"`

	// Base OS image.
	// +required
	// +kubebuilder:validation:Enum=ubuntu-22.04;ubuntu-24.04;debian-12
	Image string `json:"image"`
}

// VirtualMachineGPU defines GPU configuration for a VirtualMachine.
type VirtualMachineGPU struct {
	// Number of GPU devices (0-8).
	// +optional
	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:validation:Maximum=8
	Count int `json:"count,omitempty"`
}

// VirtualMachineSSH defines SSH access configuration.
type VirtualMachineSSH struct {
	// SSH public key to inject into the VM.
	// +optional
	PublicKey string `json:"publicKey,omitempty"`

	// EnableRootLogin enables root SSH login with password authentication.
	// When enabled, a root password is either read from RootPasswordSecret
	// or auto-generated and stored in a new Secret (referenced in status.rootPasswordSecret).
	// +optional
	EnableRootLogin bool `json:"enableRootLogin,omitempty"`

	// RootPasswordSecret references a Secret containing the root password in the "password" key.
	// If EnableRootLogin is true and this is not set, a Secret is auto-generated.
	// +optional
	RootPasswordSecret *SecretReference `json:"rootPasswordSecret,omitempty"`
}

// VirtualMachinePhase represents the lifecycle phase of a VirtualMachine.
type VirtualMachinePhase string

const (
	VirtualMachinePending      VirtualMachinePhase = "Pending"
	VirtualMachineProvisioning VirtualMachinePhase = "Provisioning"
	VirtualMachineRunning      VirtualMachinePhase = "Running"
	VirtualMachineTerminating  VirtualMachinePhase = "Terminating"
	VirtualMachineStopped      VirtualMachinePhase = "Stopped"
	VirtualMachineFailed       VirtualMachinePhase = "Failed"
)

// VirtualMachineStatus defines the observed state of VirtualMachine.
type VirtualMachineStatus struct {
	// Current lifecycle phase.
	// +optional
	Phase VirtualMachinePhase `json:"phase,omitempty"`

	// SSH endpoint (host:port) when VM is running and SSH is configured.
	// +optional
	SSHEndpoint string `json:"sshEndpoint,omitempty"`

	// Tunnel endpoint for platform proxy access.
	// +optional
	TunnelEndpoint string `json:"tunnelEndpoint,omitempty"`

	// Internal IP address within the platform network.
	// +optional
	InternalIP string `json:"internalIP,omitempty"`

	// Human-readable message about the current phase.
	// +optional
	Message string `json:"message,omitempty"`

	// RootPasswordSecret references the Secret containing the root password
	// on the workload cluster when EnableRootLogin is true. Set automatically
	// if no RootPasswordSecret was provided in spec.ssh.
	// +optional
	RootPasswordSecret *SecretReference `json:"rootPasswordSecret,omitempty"`

	// conditions represent the current state of the VirtualMachine resource.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// RelatedResources lists resources related to this VM.
	// +optional
	RelatedResources commonv1alpha1.RelatedResources `json:"relatedResources,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Cluster,shortName=vm
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Cores",type=integer,JSONPath=`.spec.cores`
// +kubebuilder:printcolumn:name="Memory",type=string,JSONPath=`.spec.memory`
// +kubebuilder:printcolumn:name="GPU",type=integer,JSONPath=`.spec.gpu.count`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// VirtualMachine is the Schema for the virtualmachines API.
type VirtualMachine struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +required
	Spec VirtualMachineSpec `json:"spec"`

	// +optional
	Status VirtualMachineStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// VirtualMachineList contains a list of VirtualMachine.
type VirtualMachineList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []VirtualMachine `json:"items"`
}

func init() {
	SchemeBuilder.Register(&VirtualMachine{}, &VirtualMachineList{})
}
