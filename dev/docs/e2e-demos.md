# End-to-End Demo Scenarios

Prerequisites: full local dev environment running (see [local-dev.md](local-dev.md)).

```bash
make dev-up          # Kind + KubeVirt + Zitadel
make console-dev     # separate terminal
make run-dev         # separate terminal
make dev-login       # separate terminal
```

---

## Demo 1: Platform Overview (5 min)

Quick overview for stakeholders.

1. Open `https://localhost:9443/console/` — show the web console
2. Sign in via Zitadel (accept self-signed cert)
3. Show workspace auto-provisioned for the user
4. Create a simple VM workload
5. Show resource status in the console

## Demo 2: Developer Experience (10 min)

Focus on the tenant developer workflow.

### Login

```bash
$ make dev-login
Opening browser for OIDC login...
Login successful! User: demo-user@example.com
```

### Explore workspace

```bash
$ kubectl ws tree
root
└── platform
    ├── providers
    └── tenants

$ kubectl api-resources
NAME              SHORTNAMES  APIVERSION                         NAMESPACED
virtualmachines   vm          compute.cloud.platform/v1alpha1    true
```

### Create a VM

```bash
$ kubectl apply -f - <<EOF
apiVersion: compute.cloud.platform/v1alpha1
kind: VirtualMachine
metadata:
  name: demo-vm
spec:
  image: ubuntu-22.04
  resources:
    cpu: 2
    memory: 4Gi
EOF

$ kubectl get virtualmachines
NAME       STATUS         AGE
demo-vm    Provisioning   5s

$ kubectl get virtualmachines
NAME       STATUS    AGE
demo-vm    Running   30s
```

### Check workload cluster

```bash
$ export KUBECONFIG=.platform-data/workload-kubeconfig
$ kubectl get pods -A | grep demo-vm
# Shows actual KubeVirt VMI on the workload cluster
```

## Demo 3: Operator Experience (10 min)

Focus on the platform operator workflow.

### kcp admin view

```bash
# Show workspace hierarchy
kubectl ws tree

# Show API exports
kubectl get apiexports -A

# Show API bindings per tenant
kubectl get apibindings -A
```

### Workload cluster health

```bash
export KUBECONFIG=.platform-data/workload-kubeconfig
kubectl get nodes
kubectl -n kubevirt get kubevirt
kubectl get pods -A
```

### Zitadel admin

Open http://localhost:8080/ui/console?login_hint=zitadel-admin@zitadel.localhost

- Show users and their provisioned workspaces
- Show OIDC applications
- Show identity providers

## Demo 4: Full Architecture Walkthrough (20 min)

For technical audience.

1. **Architecture** — show the diagram from [local-dev.md](local-dev.md)
2. **kcp** — workspace creation, APIExport/APIBinding, virtual workspaces
3. **OIDC flow** — browser login → Zitadel → callback → token → kcp proxy
4. **Operator reconciliation** — tenant creates VM → kcp event → cloud operator → KubeVirt VMI on workload cluster
5. **Network isolation** — tenant workspaces are separate kcp workspaces, workload cluster uses namespaces
6. **CLI flow** — `platform-cli login` → exec credential plugin → kubectl transparently refreshes tokens

---

## Troubleshooting During Demo

| Issue | Fix |
|-------|-----|
| Self-signed cert warning | Accept in browser, or use `--insecure-skip-tls-verify` |
| OIDC login redirect fails | Verify Zitadel is running: `make zitadel-up` |
| Console blank page | Verify console-dev is running: `make console-dev` |
| VM stuck in Provisioning | Check platform server logs and workload cluster: `KUBECONFIG=.platform-data/workload-kubeconfig kubectl get pods -A` |
| kubectl auth errors | Re-run `make dev-login` |
