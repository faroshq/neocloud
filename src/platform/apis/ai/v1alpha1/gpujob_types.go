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

// GPUJobSpec defines the desired state of GPUJob.
type GPUJobSpec struct {
	// Container image to run for the GPU job.
	// +required
	Image string `json:"image"`

	// Command to execute in the container.
	// +optional
	Command []string `json:"command,omitempty"`

	// GPU configuration (required).
	// +required
	GPU GPUJobGPU `json:"gpu"`

	// CPU and memory resources for the job pod.
	// +optional
	Resources *GPUJobResources `json:"resources,omitempty"`

	// Maximum duration before the job is terminated (e.g. "1h", "30m").
	// +optional
	// +kubebuilder:default="1h"
	Timeout string `json:"timeout,omitempty"`

	// Number of successful completions required.
	// +optional
	// +kubebuilder:default=1
	Completions int `json:"completions,omitempty"`

	// Maximum number of pods running in parallel.
	// +optional
	// +kubebuilder:default=1
	Parallelism int `json:"parallelism,omitempty"`
}

// GPUJobGPU defines GPU configuration for a GPUJob.
type GPUJobGPU struct {
	// Number of GPU devices (1-8).
	// +required
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=8
	Count int `json:"count"`
}

// GPUJobResources defines resource requests for a GPUJob.
type GPUJobResources struct {
	// CPU request (e.g. "4", "8", "16").
	// +optional
	// +kubebuilder:default="4"
	CPU string `json:"cpu,omitempty"`

	// Memory request (e.g. "16Gi", "32Gi").
	// +optional
	// +kubebuilder:default="16Gi"
	Memory string `json:"memory,omitempty"`
}

// GPUJobPhase represents the lifecycle phase of a GPUJob.
// +kubebuilder:validation:Enum=Pending;Queued;Running;Succeeded;Failed
type GPUJobPhase string

const (
	GPUJobPending   GPUJobPhase = "Pending"
	GPUJobQueued    GPUJobPhase = "Queued"
	GPUJobRunning   GPUJobPhase = "Running"
	GPUJobSucceeded GPUJobPhase = "Succeeded"
	GPUJobFailed    GPUJobPhase = "Failed"
)

// GPUJobStatus defines the observed state of GPUJob.
type GPUJobStatus struct {
	// Current lifecycle phase.
	// +optional
	Phase GPUJobPhase `json:"phase,omitempty"`

	// Timestamp when the job started executing.
	// +optional
	StartTime *metav1.Time `json:"startTime,omitempty"`

	// Timestamp when the job completed.
	// +optional
	CompletionTime *metav1.Time `json:"completionTime,omitempty"`

	// Human-readable message about the current phase.
	// +optional
	Message string `json:"message,omitempty"`

	// conditions represent the current state of the GPUJob resource.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=gj
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="GPU",type=integer,JSONPath=`.spec.gpu.count`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// GPUJob represents a batch GPU compute job.
type GPUJob struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +required
	Spec GPUJobSpec `json:"spec"`

	// +optional
	Status GPUJobStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// GPUJobList contains a list of GPUJob.
type GPUJobList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []GPUJob `json:"items"`
}

func init() {
	SchemeBuilder.Register(&GPUJob{}, &GPUJobList{})
}
