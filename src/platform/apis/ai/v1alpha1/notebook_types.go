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

// NotebookSpec defines the desired state of Notebook.
type NotebookSpec struct {
	// Jupyter notebook container image.
	// +optional
	// +kubebuilder:default="jupyter/scipy-notebook:latest"
	Image string `json:"image,omitempty"`

	// Resource requests for the notebook pod.
	// +optional
	Resources *NotebookResources `json:"resources,omitempty"`

	// Optional GPU configuration for ML workloads.
	// +optional
	GPU *NotebookGPU `json:"gpu,omitempty"`

	// Persistent storage configuration for notebook data.
	// +optional
	Storage *NotebookStorage `json:"storage,omitempty"`
}

// NotebookResources defines resource requests for a Notebook.
type NotebookResources struct {
	// CPU request (e.g. "1", "2", "4").
	// +optional
	// +kubebuilder:default="1"
	CPU string `json:"cpu,omitempty"`

	// Memory request (e.g. "4Gi", "8Gi").
	// +optional
	// +kubebuilder:default="4Gi"
	Memory string `json:"memory,omitempty"`
}

// NotebookGPU defines GPU configuration for a Notebook.
type NotebookGPU struct {
	// Number of GPU devices (0 for no GPU).
	// +optional
	// +kubebuilder:default=0
	// +kubebuilder:validation:Minimum=0
	Count int `json:"count,omitempty"`
}

// NotebookStorage defines persistent storage for a Notebook.
type NotebookStorage struct {
	// Size of the persistent volume (e.g. "10Gi", "50Gi").
	// +optional
	// +kubebuilder:default="10Gi"
	Size string `json:"size,omitempty"`
}

// NotebookPhase represents the lifecycle phase of a Notebook.
type NotebookPhase string

const (
	NotebookPending      NotebookPhase = "Pending"
	NotebookProvisioning NotebookPhase = "Provisioning"
	NotebookReady        NotebookPhase = "Ready"
	NotebookFailed       NotebookPhase = "Failed"
)

// NotebookStatus defines the observed state of Notebook.
type NotebookStatus struct {
	// Current lifecycle phase.
	// +optional
	Phase NotebookPhase `json:"phase,omitempty"`

	// URL to access the Jupyter notebook interface.
	// +optional
	URL string `json:"url,omitempty"`

	// Authentication token for accessing the notebook.
	// +optional
	Token string `json:"token,omitempty"`

	// Human-readable message about the current phase.
	// +optional
	Message string `json:"message,omitempty"`

	// conditions represent the current state of the Notebook resource.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=nb
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="URL",type=string,JSONPath=`.status.url`
// +kubebuilder:printcolumn:name="GPU",type=integer,JSONPath=`.spec.gpu.count`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Notebook represents a managed Jupyter notebook environment.
type Notebook struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +optional
	Spec NotebookSpec `json:"spec,omitempty"`

	// +optional
	Status NotebookStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// NotebookList contains a list of Notebook.
type NotebookList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Notebook `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Notebook{}, &NotebookList{})
}
