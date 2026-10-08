# What's New in 2.6.1

Everything added since `2.6.0`. Full release history is on the
[GitHub Releases](https://github.com/Azure/vscode-aks-tools/releases) page.

This is a patch release focused on security hardening and Kickstart guided-setup fixes.
There are no new commands, settings, or feature flags.

## Safer handling of cluster and kubeconfig values

Several features built shell command strings from values the extension does not
control: kubeconfig context names, and object names returned by the cluster API.
A crafted value could be interpreted by the local shell. This release closes those
paths.

- **Retina capture no longer goes through a shell.** `kubectl-retina` is invoked with
  each argument passed separately, in both the download and Blob-upload flows, so
  context names, node names, and SAS URLs are never parsed as shell syntax.
- **Names read from the cluster are validated before use.** Node, namespace, pod,
  container, and workspace names are checked against the Kubernetes DNS-1123 naming
  rules where they enter the extension, and again when they come back from a webview.
  This covers Retina capture, TCP dumps, Inspektor Gadget, KAITO, and Draft.
- **Draft is invoked without a shell.** `draft create` arguments are now built as
  arrays, removing the last shell command strings the extension assembled itself.

See [Retina Distributed Capture](../features/retina-capture.md) and
[Collect TCP Dumps](../features/tcp-dumps.md).

## Kickstart guided setup fixes

- **Repo picker ordering and search.** Repositories are ordered by most recent push
  rather than by last metadata change, show a relative last-push time, page past the
  first 100 repos, and can be searched by any part of the name or description.
- **Picking vs. pasting a repo.** Choosing from the list and pasting a URL are now
  separate inputs. Pasted URLs are normalized (bare `owner/repo`, missing scheme,
  trailing slash, and GitHub `/tree/<branch>/...` links) and validated before cloning.
- **No sign-in prompt on open.** The wizard no longer preselects GitHub and requests the
  `repo` scope immediately; sign-in happens only when you click the sign-in button.
- **Clearer chat handoff failures.** A failed handoff to Kickstart chat now shows the
  error instead of leaving "Opening the Kickstart chat..." on screen.
- **Cluster form keeps its values.** Returning to setup after a failed provisioning run
  restores the fields you entered, including the generated resource-name suffix.
- **Dropdown accessibility.** Field labels are now linked to their inputs, and the
  combobox exposes the expected ARIA roles and state.

See [Kickstart Agent for AKS Automatic (Preview)](../features/kickstart-agent.md).

## Behavior and compatibility

- **Retina and TCP dump downloads reject unsafe folder paths.** A destination path that
  contains spaces or shell punctuation is now refused with a message asking for a
  different folder. Previously, a path with a space failed silently.
- **Names that fail Kubernetes naming rules are rejected.** A conforming API server
  cannot assign such names, so real clusters are unaffected. If you see this error,
  check that your kubeconfig points at a cluster you trust.
- **Capture names derived from kubeconfig context names are sanitized** to safe
  characters.

## Under the hood

- Routine dependency updates across the extension, webview, and repository CI
  workflows, including `mocha` 12, `@grpc/grpc-js`, `protobufjs`, and `undici`.

## Thanks

Thanks to @bosesuneha and @Tatsinnit for contributions, testing, and reviews.

## Where to go next

- [What the extension can do](../features/features.md)
- [Every command, setting and pinned tool version](../reference.md)
