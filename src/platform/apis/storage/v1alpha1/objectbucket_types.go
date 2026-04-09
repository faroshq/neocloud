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

// ObjectBucketSpec defines the desired state of ObjectBucket.
type ObjectBucketSpec struct {
	// Maximum storage quota for the bucket (e.g. "100Gi", "1Ti").
	// +optional
	// +kubebuilder:default="100Gi"
	Quota string `json:"quota,omitempty"`
}

// ObjectBucketPhase represents the lifecycle phase of an ObjectBucket.
type ObjectBucketPhase string

const (
	ObjectBucketPending      ObjectBucketPhase = "Pending"
	ObjectBucketProvisioning ObjectBucketPhase = "Provisioning"
	ObjectBucketReady        ObjectBucketPhase = "Ready"
	ObjectBucketFailed       ObjectBucketPhase = "Failed"
)

// ObjectBucketStatus defines the observed state of ObjectBucket.
type ObjectBucketStatus struct {
	// Current lifecycle phase.
	// +optional
	Phase ObjectBucketPhase `json:"phase,omitempty"`

	// S3-compatible endpoint URL for accessing the bucket.
	// +optional
	Endpoint string `json:"endpoint,omitempty"`

	// Access key ID for authenticating to the bucket.
	// +optional
	AccessKeyID string `json:"accessKeyID,omitempty"`

	// Actual name of the bucket on the underlying storage system.
	// +optional
	BucketName string `json:"bucketName,omitempty"`

	// Human-readable message about the current phase.
	// +optional
	Message string `json:"message,omitempty"`

	// conditions represent the current state of the ObjectBucket resource.
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=ob
// +kubebuilder:printcolumn:name="Status",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Quota",type=string,JSONPath=`.spec.quota`
// +kubebuilder:printcolumn:name="Endpoint",type=string,JSONPath=`.status.endpoint`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// ObjectBucket represents an S3-compatible object storage bucket.
type ObjectBucket struct {
	metav1.TypeMeta `json:",inline"`

	// +optional
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// +optional
	Spec ObjectBucketSpec `json:"spec,omitempty"`

	// +optional
	Status ObjectBucketStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// ObjectBucketList contains a list of ObjectBucket.
type ObjectBucketList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ObjectBucket `json:"items"`
}

func init() {
	SchemeBuilder.Register(&ObjectBucket{}, &ObjectBucketList{})
}
