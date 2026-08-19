# Merge and Save Into Kubeconfig

These two commands are provided by the
[Kubernetes extension](https://marketplace.visualstudio.com/items?itemName=ms-kubernetes-tools.vscode-kubernetes-tools),
not by this one. They are listed here because they appear on the same AKS cluster node in
the Cloud Explorer, and because that extension is installed automatically as a dependency
of this one.

## Merge into Kubeconfig

Right-click your AKS cluster > **Merge into Kubeconfig** to add the cluster to your existing
kubeconfig file, leaving any other contexts in place.

## Save Kubeconfig

Right-click your AKS cluster > **Save Kubeconfig** to write the cluster's kubeconfig to a
file you choose, without touching your existing kubeconfig.

Because these commands come from the Kubernetes extension, their exact labels and menu
placement are controlled by that extension and can change independently of this one.
