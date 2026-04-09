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
)

// VolumeSpec defines the desired state of Volume.
type VolumeSpec struct {
	// Size of the volume in Kubernetes resource format (e.g. "10Gi", "100Gi").
	// +required
	Size string `json:"size"`

	// Storage class determines the underlying storage technology.
	// +optional
	// +kubebuilder:default=ssd
	// +kubebuilder:validation:Enum=ssd;hdd
	StorageClass string `json:"storageClass,omitempty"`

	// Access mode controls how the volume can be mounted.
	// +optional
	// +kubebuilder:default=ReadWriteOnce
	// +kubebuilder:validation:Enum=ReadWriteOnce;ReadWriteMany
	AccessMode string `json:"accessMode,omitempty"`
}

// VolumePhase represents the lifecycle phase of a Volume.
type VolumePhase string

const (
	VolumePending      VolumePhase = "Pending"
	VolumeProvisioning VolumePhase = "Provisioning"
	VolumeAvailable    VolumePhase = "Available"
	VolumeBound        VolumePhase = "Bound"
	VolumeFailed       VolumePhase = "Failed"
)

// VolumeStatus defines the observed state of Volume.
type VolumeStatus struct {
	// Current lifecycle phase.
	// +optional
	Phase VolumePhase `json:"phase,omitempty"`

	// Unique identifier of the provisioned volume on the underlying storage system.
	// +optional
	VolumeID string `json:"volumeID,omitempty"`

	// Human-readable message about the current phase.
	// +optional
	Message string `json:"message,omitempty"`

	// conditions represent the current state of the Volume resource.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=vol
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Size",type=string,JSONPath=`.spec.size`
// +kubebuilder:printcolumn:name="Class",type=string,JSONPath=`.spec.storageClass`
// +kubebuilder:printcolumn:name="Access",type=string,JSONPath=`.spec.accessMode`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Volume represents a persistent block storage volume.
type Volume struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +required
	Spec VolumeSpec `json:"spec"`

	// +optional
	Status VolumeStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// VolumeList contains a list of Volume.
type VolumeList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Volume `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Volume{}, &VolumeList{})
}
