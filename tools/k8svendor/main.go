// Command k8svendor splits rendered Kubernetes manifests for vendoring
// (deploy/kubernetes/scripts/vendor.sh). kustomize renders grounded-config
// with a content hash in its name; a vendored copy must instead generate
// that ConfigMap itself, so the consumer's overlay can merge keys into it
// and its own build hashes the result and rolls the pods.
//
//	k8svendor -name grounded-config -manifests OUT.yaml -env OUT.env < rendered.yaml
//
// It writes the manifests without the ConfigMap (references renamed to the
// plain name) and the ConfigMap's data as an env file, and prints the
// ConfigMap's labels as "key: value" lines for the generator's options.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type object struct {
	Kind     string `yaml:"kind"`
	Metadata struct {
		Name   string            `yaml:"name"`
		Labels map[string]string `yaml:"labels"`
	} `yaml:"metadata"`
	Data map[string]string `yaml:"data"`
}

func main() {
	name := flag.String("name", "grounded-config", "ConfigMap to turn into a generator")
	manifests := flag.String("manifests", "", "output: manifests without the ConfigMap")
	envFile := flag.String("env", "", "output: the ConfigMap data as an env file")
	flag.Parse()
	if *manifests == "" || *envFile == "" {
		flag.Usage()
		os.Exit(2)
	}
	in, err := io.ReadAll(os.Stdin)
	if err == nil {
		err = run(string(in), *name, *manifests, *envFile, os.Stdout)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "k8svendor:", err)
		os.Exit(1)
	}
}

func run(rendered, name, manifestsPath, envPath string, labelsOut io.Writer) error {
	docs, cm, err := split(rendered, name)
	if err != nil {
		return err
	}
	env, err := envFile(cm.Data)
	if err != nil {
		return err
	}
	// The hashed name is distinctive (name-<10 characters>), so a plain
	// replacement renames every reference and nothing else.
	out := strings.ReplaceAll(strings.Join(docs, "---\n"), cm.Metadata.Name, name)
	if err := os.WriteFile(manifestsPath, []byte(out), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(envPath, []byte(env), 0o644); err != nil {
		return err
	}
	keys := make([]string, 0, len(cm.Metadata.Labels))
	for k := range cm.Metadata.Labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(labelsOut, "%s: %s\n", k, cm.Metadata.Labels[k])
	}
	return nil
}

// split separates the ConfigMap generated as name-<hash> (or plain name)
// from the other documents, which are kept as rendered.
func split(rendered, name string) ([]string, object, error) {
	generated := regexp.MustCompile("^" + regexp.QuoteMeta(name) + "(-[a-z0-9]{10})?$")
	var docs []string
	var cm *object
	for _, doc := range strings.Split(rendered, "\n---\n") {
		doc = strings.TrimPrefix(doc, "---\n")
		if strings.TrimSpace(doc) == "" {
			continue
		}
		if !strings.HasSuffix(doc, "\n") {
			doc += "\n"
		}
		var o object
		if err := yaml.Unmarshal([]byte(doc), &o); err != nil {
			return nil, object{}, err
		}
		if o.Kind == "ConfigMap" && generated.MatchString(o.Metadata.Name) {
			if cm != nil {
				return nil, object{}, fmt.Errorf("two ConfigMaps named %s", name)
			}
			cm = &o
			continue
		}
		docs = append(docs, doc)
	}
	if cm == nil {
		return nil, object{}, fmt.Errorf("no ConfigMap %s in the input", name)
	}
	return docs, *cm, nil
}

// envFile renders data as KEY=value lines, sorted. kustomize reads values
// literally, so values must be single lines.
func envFile(data map[string]string) (string, error) {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString("# grounded-config, rendered from deploy/kubernetes/base/config.env and the chosen components.\n")
	for _, k := range keys {
		v := data[k]
		if strings.ContainsAny(v, "\r\n") {
			return "", errors.New("value of " + k + " spans lines; env files cannot hold it")
		}
		fmt.Fprintf(&b, "%s=%s\n", k, v)
	}
	return b.String(), nil
}
