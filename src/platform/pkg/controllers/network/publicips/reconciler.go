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

package publicips

import (
	"context"

	"k8s.io/klog/v2"
	ctrl "sigs.k8s.io/controller-runtime"

	networkv1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/network/v1alpha1"

	mcbuilder "sigs.k8s.io/multicluster-runtime/pkg/builder"
	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
	mcreconcile "sigs.k8s.io/multicluster-runtime/pkg/reconcile"
)

// Reconciler reconciles PublicIP resources.
type Reconciler struct {
	mgr mcmanager.Manager
}

// SetupWithManager sets up the controller with the multicluster manager.
func SetupWithManager(mgr mcmanager.Manager) error {
	r := &Reconciler{mgr: mgr}
	return mcbuilder.ControllerManagedBy(mgr).
		Named("publicip").
		For(&networkv1alpha1.PublicIP{}).
		Complete(r)
}

// Reconcile handles a PublicIP reconciliation event.
func (r *Reconciler) Reconcile(ctx context.Context, req mcreconcile.Request) (ctrl.Result, error) {
	logger := klog.FromContext(ctx).WithValues("publicip", req.NamespacedName, "cluster", req.ClusterName)
	logger.V(4).Info("Reconciling PublicIP (stub)")
	return ctrl.Result{}, nil
}
