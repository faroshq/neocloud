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

package server

import (
	apiskcpv1alpha1 "github.com/kcp-dev/sdk/apis/apis/v1alpha1"
	apiskcpv1alpha2 "github.com/kcp-dev/sdk/apis/apis/v1alpha2"
	corev1alpha1 "github.com/kcp-dev/sdk/apis/core/v1alpha1"
	kcptenancyv1alpha1 "github.com/kcp-dev/sdk/apis/tenancy/v1alpha1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"

	aiv1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/ai/v1alpha1"
	computev1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/compute/v1alpha1"
	networkv1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/network/v1alpha1"
	storagev1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/storage/v1alpha1"
)

// NewScheme builds a runtime.Scheme containing all types needed by the
// multicluster manager: core k8s types, platform CRDs, and kcp SDK types.
func NewScheme() *runtime.Scheme {
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(computev1alpha1.AddToScheme(s))
	utilruntime.Must(networkv1alpha1.AddToScheme(s))
	utilruntime.Must(storagev1alpha1.AddToScheme(s))
	utilruntime.Must(aiv1alpha1.AddToScheme(s))
	utilruntime.Must(corev1alpha1.AddToScheme(s))
	utilruntime.Must(kcptenancyv1alpha1.AddToScheme(s))
	utilruntime.Must(apiskcpv1alpha1.AddToScheme(s))
	utilruntime.Must(apiskcpv1alpha2.AddToScheme(s))
	return s
}
