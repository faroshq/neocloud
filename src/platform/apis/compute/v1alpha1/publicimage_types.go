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

// PublicImageSpec defines the desired state of PublicImage.
type PublicImageSpec struct {
	// Container disk image reference (e.g. "quay.io/containerdisks/ubuntu:22.04").
	// +required
	Image string `json:"image"`

	// Human-readable display name for the image.
	// +required
	DisplayName string `json:"displayName"`

	// Short description of the image.
	// +optional
	Description string `json:"description,omitempty"`

	// Operating system family (e.g. "linux", "windows").
	// +optional
	// +kubebuilder:default=linux
	OS string `json:"os,omitempty"`

	// Category groups images for display (e.g. "ubuntu", "fedora", "centos").
	// +optional
	Category string `json:"category,omitempty"`

	// Tags for filtering and search.
	// +optional
	Tags []string `json:"tags,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Cluster,shortName=pimg
// +kubebuilder:printcolumn:name="Image",type=string,JSONPath=`.spec.image`
// +kubebuilder:printcolumn:name="Display Name",type=string,JSONPath=`.spec.displayName`
// +kubebuilder:printcolumn:name="OS",type=string,JSONPath=`.spec.os`
// +kubebuilder:printcolumn:name="Category",type=string,JSONPath=`.spec.category`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PublicImage is a catalog entry for a container disk image available
// for use as a VM boot disk. These are distributed to all bound workspaces
// via the cloud.platform APIExport as cached resources.
type PublicImage struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +required
	Spec PublicImageSpec `json:"spec"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PublicImageList contains a list of PublicImage.
type PublicImageList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []PublicImage `json:"items"`
}

func init() {
	SchemeBuilder.Register(&PublicImage{}, &PublicImageList{})
}
