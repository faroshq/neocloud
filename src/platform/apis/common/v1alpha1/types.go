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
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// RelatedResource defines a reference to a related resource.
type RelatedResource struct {
	// +optional
	Namespace string `json:"namespace,omitempty"`
	// +required
	Name string `json:"name"`
	// +required
	GVK metav1.GroupVersionKind `json:"gvk"`
}

// SchemaGVK returns the schema.GroupVersionKind of the GVK.
func (rr RelatedResource) SchemaGVK() schema.GroupVersionKind {
	group := rr.GVK.Group
	if group == "core" {
		group = ""
	}
	return schema.GroupVersionKind{
		Group:   group,
		Version: rr.GVK.Version,
		Kind:    rr.GVK.Kind,
	}
}

// RelatedResources is a map of related resources keyed by an arbitrary identifier.
type RelatedResources map[string]RelatedResource

// Standard condition types for platform resources.
const (
	ConditionAvailable  = "Available"
	ConditionProgessing = "Progressing"
	ConditionDegraded   = "Degraded"
)
