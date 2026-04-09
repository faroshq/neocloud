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

package notebooks

import (
	"context"

	"k8s.io/klog/v2"
	ctrl "sigs.k8s.io/controller-runtime"

	aiv1alpha1 "github.com/faroshq/kcp-ref-arch/project/platform/apis/ai/v1alpha1"

	mcbuilder "sigs.k8s.io/multicluster-runtime/pkg/builder"
	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
	mcreconcile "sigs.k8s.io/multicluster-runtime/pkg/reconcile"
)

// Reconciler reconciles Notebook resources.
type Reconciler struct {
	mgr mcmanager.Manager
}

// SetupWithManager sets up the controller with the multicluster manager.
func SetupWithManager(mgr mcmanager.Manager) error {
	r := &Reconciler{mgr: mgr}
	return mcbuilder.ControllerManagedBy(mgr).
		Named("notebook").
		For(&aiv1alpha1.Notebook{}).
		Complete(r)
}

// Reconcile handles a Notebook reconciliation event.
func (r *Reconciler) Reconcile(ctx context.Context, req mcreconcile.Request) (ctrl.Result, error) {
	logger := klog.FromContext(ctx).WithValues("notebook", req.NamespacedName, "cluster", req.ClusterName)
	logger.V(4).Info("Reconciling Notebook (stub)")
	return ctrl.Result{}, nil
}
