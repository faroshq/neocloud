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

// PublicCloudInitSpec defines the desired state of PublicCloudInit.
type PublicCloudInitSpec struct {
	// Human-readable display name for the cloud-init template.
	// +required
	DisplayName string `json:"displayName"`

	// Short description of the cloud-init template.
	// +optional
	Description string `json:"description,omitempty"`

	// Cloud-init user-data template content.
	// Supports the following template variables:
	//   {{.Hostname}} - the VM hostname
	//   {{.SSHPublicKey}} - the SSH public key (if configured)
	// +required
	UserData string `json:"userData"`

	// Operating system family this cloud-init is designed for (e.g. "linux", "windows").
	// +optional
	// +kubebuilder:default=linux
	OS string `json:"os,omitempty"`

	// Category groups cloud-init templates for display (e.g. "debian", "redhat", "generic").
	// +optional
	Category string `json:"category,omitempty"`

	// Tags for filtering and search.
	// +optional
	Tags []string `json:"tags,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Cluster,shortName=pci
// +kubebuilder:printcolumn:name="Display Name",type=string,JSONPath=`.spec.displayName`
// +kubebuilder:printcolumn:name="OS",type=string,JSONPath=`.spec.os`
// +kubebuilder:printcolumn:name="Category",type=string,JSONPath=`.spec.category`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PublicCloudInit is a catalog entry for a cloud-init template available
// for use when provisioning VMs. These are distributed to all bound workspaces
// via the cloud.platform APIExport as cached resources.
type PublicCloudInit struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +required
	Spec PublicCloudInitSpec `json:"spec"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PublicCloudInitList contains a list of PublicCloudInit.
type PublicCloudInitList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []PublicCloudInit `json:"items"`
}

func init() {
	SchemeBuilder.Register(&PublicCloudInit{}, &PublicCloudInitList{})
}
