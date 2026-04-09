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

// PublicIPSpec defines the desired state of PublicIP.
type PublicIPSpec struct {
	// Reference to the target resource to assign the IP to.
	// +optional
	TargetRef *TargetReference `json:"targetRef,omitempty"`
}

// TargetReference identifies a resource that should receive a public IP address.
type TargetReference struct {
	// Kind of the target resource (e.g. "VirtualMachine").
	// +required
	Kind string `json:"kind"`

	// Name of the target resource in the same namespace.
	// +required
	Name string `json:"name"`
}

// PublicIPPhase represents the lifecycle phase of a PublicIP.
type PublicIPPhase string

const (
	PublicIPPending    PublicIPPhase = "Pending"
	PublicIPAllocating PublicIPPhase = "Allocating"
	PublicIPAssigned   PublicIPPhase = "Assigned"
	PublicIPReleased   PublicIPPhase = "Released"
	PublicIPFailed     PublicIPPhase = "Failed"
)

// PublicIPStatus defines the observed state of PublicIP.
type PublicIPStatus struct {
	// Current lifecycle phase.
	// +optional
	Phase PublicIPPhase `json:"phase,omitempty"`

	// The allocated public IPv4 address (e.g. "203.0.113.42").
	// +optional
	Address string `json:"address,omitempty"`

	// Human-readable message about the current phase.
	// +optional
	Message string `json:"message,omitempty"`

	// conditions represent the current state of the PublicIP resource.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=pip
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Address",type=string,JSONPath=`.status.address`
// +kubebuilder:printcolumn:name="Target",type=string,JSONPath=`.spec.targetRef.name`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PublicIP represents a public IPv4 address that can be assigned
// to a Compute or VirtualMachine instance.
type PublicIP struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +optional
	Spec PublicIPSpec `json:"spec,omitempty"`

	// +optional
	Status PublicIPStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PublicIPList contains a list of PublicIP.
type PublicIPList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []PublicIP `json:"items"`
}

func init() {
	SchemeBuilder.Register(&PublicIP{}, &PublicIPList{})
}
