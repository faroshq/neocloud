.PHONY: build build-platform build-cli build-console clean generate lint test tidy codegen crds tools verify-codegen docker-console run-console console-dev zitadel-up zitadel-down run-dev dev-login lima-up lima-down lima-kubeconfig lima-ssh lima-status demo-vm demo-vm-clean dev-up dev-down

PLATFORM_DIR := project/platform
CONSOLE_DIR := project/console
BINARY_DIR := bin

# Tool versions (matching kedge)
CONTROLLER_GEN_VER := v0.16.5
CONTROLLER_GEN_BIN := controller-gen
CONTROLLER_GEN := $(PLATFORM_DIR)/hack/tools/$(CONTROLLER_GEN_BIN)-$(CONTROLLER_GEN_VER)
export CONTROLLER_GEN

KCP_APIGEN_VER := v0.30.0
KCP_APIGEN_BIN := apigen
KCP_APIGEN_GEN := $(PLATFORM_DIR)/hack/tools/$(KCP_APIGEN_BIN)-$(KCP_APIGEN_VER)
export KCP_APIGEN_GEN

GO_INSTALL := $(PLATFORM_DIR)/hack/go-install.sh
TOOLS_GOBIN_DIR := $(abspath $(PLATFORM_DIR)/hack/tools)

# --- Build ---

build: build-platform build-cli

build-platform:
	cd $(PLATFORM_DIR) && go build -o ../../$(BINARY_DIR)/platform ./cmd/platform

build-cli:
	cd $(PLATFORM_DIR) && go build -o ../../$(BINARY_DIR)/platform-cli ./cmd/cli

build-console: ## Build the Piral console app shell
	cd $(CONSOLE_DIR) && npm install --workspaces && cd app-shell && npm run build

console-dev: ## Run console in dev mode (hot reload on :1234)
	cd $(CONSOLE_DIR) && npm install --workspaces && cd app-shell && npm run start

docker-console: ## Build console Docker image
	cd $(CONSOLE_DIR) && docker build -t platform-console:latest .

run-console: docker-console ## Build and run NeoCloud console via Docker
	docker rm -f platform-console 2>/dev/null || true
	docker run --name platform-console -p 4466:4466 platform-console:latest
	@echo "Console running at http://localhost:4466/"

# --- Code generation ---

crds: $(CONTROLLER_GEN) $(KCP_APIGEN_GEN) ## Generate CRDs, deepcopy, and kcp APIResourceSchemas
	cd $(PLATFORM_DIR) && ./hack/update-codegen-crds.sh

codegen: crds ## Generate all (CRDs + kcp resources + deepcopy)

verify-codegen: codegen ## Verify codegen is up to date
	@if ! git diff --quiet HEAD -- $(PLATFORM_DIR); then \
		echo "ERROR: codegen produced a diff. Please run 'make codegen' and commit the result."; \
		git diff --stat HEAD -- $(PLATFORM_DIR); \
		exit 1; \
	fi

# --- Tools ---

tools: $(CONTROLLER_GEN) $(KCP_APIGEN_GEN) ## Install all dev tools

$(CONTROLLER_GEN):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) sigs.k8s.io/controller-tools/cmd/controller-gen $(CONTROLLER_GEN_BIN) $(CONTROLLER_GEN_VER)

$(KCP_APIGEN_GEN):
	GOBIN=$(TOOLS_GOBIN_DIR) $(GO_INSTALL) github.com/kcp-dev/sdk/cmd/apigen $(KCP_APIGEN_BIN) $(KCP_APIGEN_VER)

# --- Standard targets ---

clean:
	rm -rf $(BINARY_DIR)
	rm -rf $(PLATFORM_DIR)/hack/tools
	rm -rf $(CONSOLE_DIR)/app-shell/dist $(CONSOLE_DIR)/app-shell/node_modules
	rm -rf $(CONSOLE_DIR)/pilets/*/dist $(CONSOLE_DIR)/pilets/*/node_modules
	rm -rf $(CONSOLE_DIR)/node_modules

generate:
	cd $(PLATFORM_DIR) && go generate ./...

test:
	cd $(PLATFORM_DIR) && go test ./... -count=1

lint:
	cd $(PLATFORM_DIR) && golangci-lint run ./...

tidy:
	cd $(PLATFORM_DIR) && go mod tidy

# --- Dev environment ---
# Zitadel
# Username: zitadel-admin@zitadel.localhost
# Password: Password1! 
# http://localhost:8080/ui/console?login_hint=zitadel-admin@zitadel.localhost 


ZITADEL_COMPOSE_DIR := project/zitadel-compose
LIMA_VM_NAME ?= kubevirt-dev
LIMA_CONFIG := deploy/lima/kubevirt-dev.yaml
KUBEVIRT_VERSION ?= v1.8.1
WORKLOAD_KUBECONFIG ?= .platform-data/workload-kubeconfig

OIDC_ISSUER_URL ?= http://localhost:8080
OIDC_CLIENT_ID ?= 366808256712106243
CONSOLE_ADDR ?= localhost:1234

# --- Lima + KubeVirt (amd64 QEMU VM) ---

lima-up: ## Create Lima x86_64 VM with k3s + KubeVirt
	@if limactl list -q 2>/dev/null | grep -q "^$(LIMA_VM_NAME)$$"; then \
		echo "Lima VM '$(LIMA_VM_NAME)' already exists. Use 'make lima-down' to recreate."; \
	else \
		echo "Creating Lima x86_64 VM '$(LIMA_VM_NAME)' with k3s + KubeVirt..."; \
		limactl create --name=$(LIMA_VM_NAME) $(LIMA_CONFIG); \
		limactl start $(LIMA_VM_NAME); \
		echo "VM provisioning — this takes ~10 min (QEMU x86 emulation). Run 'make lima-status' to check."; \
	fi

lima-kubeconfig: ## Copy kubeconfig from Lima VM to local workload-kubeconfig
	@echo "Fetching kubeconfig from $(LIMA_VM_NAME)..."
	@limactl shell $(LIMA_VM_NAME) sudo cat /root/kubeconfig-external > $(WORKLOAD_KUBECONFIG)
	@echo "Workload kubeconfig written to $(WORKLOAD_KUBECONFIG)"

lima-ssh: ## SSH into the Lima KubeVirt VM
	limactl shell $(LIMA_VM_NAME)

lima-status: ## Check KubeVirt setup progress on the Lima VM
	@echo "--- VM status ---"
	@limactl list | grep $(LIMA_VM_NAME) || echo "VM not found"
	@echo ""
	@echo "--- k3s node ---"
	@limactl shell $(LIMA_VM_NAME) sudo /usr/local/bin/kubectl get nodes 2>/dev/null || echo "(k3s not ready)"
	@echo ""
	@echo "--- pods ---"
	@limactl shell $(LIMA_VM_NAME) sudo /usr/local/bin/kubectl get pods -A 2>/dev/null || echo "(k3s not ready)"
	@echo ""
	@limactl shell $(LIMA_VM_NAME) sudo test -f /root/.kubevirt-ready 2>/dev/null && echo "KubeVirt is READY" || echo "KubeVirt is NOT ready yet"

lima-down: ## Delete Lima KubeVirt VM
	limactl stop $(LIMA_VM_NAME) 2>/dev/null || true
	limactl delete $(LIMA_VM_NAME) 2>/dev/null || true
	@rm -f $(WORKLOAD_KUBECONFIG)
	@echo "Lima VM '$(LIMA_VM_NAME)' deleted."

demo-vm: ## Create a demo VM on the workload cluster
	KUBECONFIG=$(WORKLOAD_KUBECONFIG) kubectl apply -f deploy/kubevirt/demo-vm.yaml
	@echo "Waiting for VM to start..."
	KUBECONFIG=$(WORKLOAD_KUBECONFIG) kubectl wait vm/demo-vm --for=condition=Ready --timeout=180s
	@echo ""
	@echo "Demo VM is running. Access it with:"
	@echo "  KUBECONFIG=$(WORKLOAD_KUBECONFIG) virtctl console demo-vm"
	@echo "  (login: root / demo)"

demo-vm-clean: ## Delete the demo VM
	KUBECONFIG=$(WORKLOAD_KUBECONFIG) kubectl delete -f deploy/kubevirt/demo-vm.yaml --ignore-not-found

# --- Zitadel ---

zitadel-up: ## Start Zitadel via docker-compose
	cd $(ZITADEL_COMPOSE_DIR) && docker compose up -d --wait

zitadel-down: ## Stop Zitadel
	cd $(ZITADEL_COMPOSE_DIR) && docker compose down

# --- Run ---

run-dev: build-platform zitadel-up ## Run platform with embedded kcp, console proxy, Zitadel OIDC, and workload cluster
	./$(BINARY_DIR)/platform start \
		--embedded-kcp \
		--dev-mode \
		--console-addr $(CONSOLE_ADDR) \
		--oidc-issuer-url $(OIDC_ISSUER_URL) \
		$(if $(OIDC_CLIENT_ID),--oidc-client-id $(OIDC_CLIENT_ID),) \
		$(if $(wildcard $(WORKLOAD_KUBECONFIG)),--workload-kubeconfig $(WORKLOAD_KUBECONFIG),)

dev-login: build-cli ## Login to local dev platform via OIDC
	./$(BINARY_DIR)/platform-cli login \
		--hub-url https://localhost:9443 \
		--insecure-skip-tls-verify

# --- Full dev environment lifecycle ---

dev-up: lima-up lima-kubeconfig zitadel-up ## Bring up all dev dependencies (Lima+KubeVirt, Zitadel)
	@echo "Dev environment ready. Run 'make run-dev' to start the platform."

dev-down: zitadel-down lima-down ## Tear down all dev dependencies
