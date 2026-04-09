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

// patch-virtual-storage rewrites the storage stanza in generated APIExport
// YAML files for resources that use KCP CachedResource virtual storage
// instead of CRD storage. apigen always emits "storage: crd: {}" but
// cached/replicated resources (publicimages, publiccloudinits) need virtual
// storage referencing a CachedResourceEndpointSlice.
//
// The list of virtual-storage resources is maintained in this file. Add new
// entries to the virtualResources slice when introducing new cached resources.
//
// Usage:
//
//	go run ./hack/patch-virtual-storage --config-dir config/kcp/compute
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"sigs.k8s.io/yaml"
)

// virtualResource defines a resource that should use virtual storage
// backed by a CachedResourceEndpointSlice instead of CRD storage.
type virtualResource struct {
	// name is the resource name (plural) as it appears in the APIExport.
	name string
	// identityHashPlaceholder is the placeholder string that will be
	// replaced at bootstrap time with the real identity hash.
	identityHashPlaceholder string
}

// virtualResources lists all resources that should use virtual storage.
// Add new entries here when introducing new CachedResource-backed APIs.
var virtualResources = []virtualResource{
	{name: "publicimages", identityHashPlaceholder: "__PUBLICIMAGES_IDENTITY_HASH__"},
	{name: "publiccloudinits", identityHashPlaceholder: "__PUBLICCLOUDINITS_IDENTITY_HASH__"},
}

func main() {
	configDir := flag.String("config-dir", "config/kcp/compute", "directory containing APIExport YAML files")
	flag.Parse()

	// Build lookup set.
	vrMap := make(map[string]virtualResource)
	for _, vr := range virtualResources {
		vrMap[vr.name] = vr
	}

	entries, err := os.ReadDir(*configDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading config dir %s: %v\n", *configDir, err)
		os.Exit(1)
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		// Only process apiexport files.
		if !strings.HasPrefix(name, "apiexport-") || !strings.HasSuffix(name, ".yaml") {
			continue
		}

		path := filepath.Join(*configDir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error reading %s: %v\n", path, err)
			os.Exit(1)
		}

		// Use untyped map to preserve original YAML key casing.
		var doc map[string]interface{}
		if err := yaml.Unmarshal(data, &doc); err != nil {
			fmt.Fprintf(os.Stderr, "error parsing %s: %v\n", path, err)
			os.Exit(1)
		}

		spec, ok := doc["spec"].(map[string]interface{})
		if !ok {
			continue
		}
		resources, ok := spec["resources"].([]interface{})
		if !ok {
			continue
		}

		changed := false
		for i, raw := range resources {
			res, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			resName, _ := res["name"].(string)
			vr, ok := vrMap[resName]
			if !ok {
				continue
			}

			// Replace storage with virtual storage.
			res["storage"] = map[string]interface{}{
				"virtual": map[string]interface{}{
					"reference": map[string]interface{}{
						"apiGroup": "cache.kcp.io",
						"kind":     "CachedResourceEndpointSlice",
						"name":     vr.name,
					},
					"identityHash": vr.identityHashPlaceholder,
				},
			}
			resources[i] = res
			changed = true
			fmt.Printf("  Patched %s in %s: crd -> virtual storage\n", resName, name)
		}

		if changed {
			out, err := yaml.Marshal(doc)
			if err != nil {
				fmt.Fprintf(os.Stderr, "error marshaling %s: %v\n", path, err)
				os.Exit(1)
			}
			if err := os.WriteFile(path, out, 0644); err != nil {
				fmt.Fprintf(os.Stderr, "error writing %s: %v\n", path, err)
				os.Exit(1)
			}
		}
	}
}
