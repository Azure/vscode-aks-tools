# Kubernetes API Health Endpoints

## Run Kubernetes API Health Endpoints

Right-click your AKS cluster > **Develop & Deploy** > **Run Kubectl Commands**, then run a command from the *Health* section:

| Command | Runs |
|---|---|
| Get All Events | `get events --all-namespaces` |
| Healthz Check | `get --raw /healthz?verbose` |
| Livez Check | `get --raw /livez?verbose` |
| Readyz Check | `get --raw /readyz?verbose` |

![Kubectl health command panel](../resources/kubectl-command-panel.png)