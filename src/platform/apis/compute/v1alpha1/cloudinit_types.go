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

// CloudInitSpec defines the desired state of CloudInit.
type CloudInitSpec struct {
	// Human-readable display name for the cloud-init template.
	// +optional
	DisplayName string `json:"displayName,omitempty"`

	// Short description of the cloud-init template.
	// +optional
	Description string `json:"description,omitempty"`

	// Cloud-init user-data template content.
	// Supports the following template variables:
	//   {{.Hostname}} - the VM hostname
	//   {{.SSHPublicKey}} - the SSH public key (if configured)
	// +required
	UserData string `json:"userData"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Cluster,shortName=ci
// +kubebuilder:printcolumn:name="Display Name",type=string,JSONPath=`.spec.displayName`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// CloudInit is a user-owned cloud-init template for VM provisioning.
type CloudInit struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +required
	Spec CloudInitSpec `json:"spec"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// CloudInitList contains a list of CloudInit.
type CloudInitList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []CloudInit `json:"items"`
}

func init() {
	SchemeBuilder.Register(&CloudInit{}, &CloudInitList{})
}
