# What's New in 2.1.0

Version `2.1.0` updates Container Assist preview behavior to be enabled by default.

## Highlights

- `aks.containerAssistEnabledPreview` now defaults to `true`.
- Container Assist entry points are available out of the box when a workspace folder is open.
- Users can still disable Container Assist via settings when needed.

## Feature flag behavior

```json
{
  "aks.containerAssistEnabledPreview": true
}
```

Default in `2.1.0`: `true`

To disable:

```json
{
  "aks.containerAssistEnabledPreview": false
}
```

## Related docs

- [Container Assist Integration (Preview)](../features/container-assist-integration.md)
- [Simplified AKS Menu Structure](../features/simplified-menu-structure.md)
