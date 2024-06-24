# Authentication

The files in this folder handle Microsoft authentication, session management, and account and tenant selection.

## Background

Historically, authentication was handled by the [Azure Account](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account) extension. This has since been [deprecated](https://github.com/microsoft/vscode-azure-account/issues/964).

The 'Extension authors' guidance in the deprecation notice outlines two approaches for removing the Azure Account dependency:
1. Using the wrapper defined in the [`@microsoft/vscode-azext-azureauth` package](https://www.npmjs.com/package/@microsoft/vscode-azext-azureauth).
2. Using the [VS Code authentication APIs](https://code.visualstudio.com/api/references/vscode-api#authentication) directly.

Our extension adopted the latter approach (and is called out as a possible example to follow in the deprecation notice).

### Why not use the wrapper package?

The `@microsoft/vscode-azext-azureauth` wrapper package provides an abstraction over _subscriptions_ specifically. That intent is reflected in the interface name: `AzureSubscriptionProvider`, and it's an appropriate abstraction for most Azure extensions.

For the AKS extension, we _do_ have a list of subscriptions in the Cloud Explorer tree view. However, this is not the only entrypoint to functionality that consumes Azure APIs. We also launch commands from the file explorer view and the command palette. For that reason, we use a slightly different abstraction, the `AzureSessionProvider`. The benefits of this are:
- Consistency of use: It enables us to use the same pattern for interacting with ARM SDKs (getting credentials and instantiating clients), regardless of where a command was launched from.
- Separation of concerns: Conceptually, subscriptions are not intrinsically tied to sessions/credentials, and they certainly have different lifetimes. It makes sense for the tree view to only expose persistent properties of resources like IDs and names. This eliminates any risk that associated sessions or credentials would become stale.

## Responsibilities

The `AzureSessionProvider` has two main responsibilities:
- Microsoft session management (sign-in, sign-out, and tracking which tenants are accessible)
- Account and tenant selection (this determines the context of the Cloud Explorer tree view)

As far as VS Code is concerned, there is no built-in concept of a 'currently-selected' account or tenant. Users can be signed in to several accounts for each provider (Microsoft and GitHub are examples of providers). To provide a user experience in which the user feels they are 'in' a particular tenant, running 'as' a particular user, we need to manage that selection state ourselves.

## Future maintenance

The responsibilities above might be better handled separately. For example, we don't necessarily need the user to feel as if they are operating within a currently-selected tenant, as they do in the Azure Portal. The VS Code UX might be better suited to a stateless experience, in which the account and tenant is explicitly selected for each command.

There are [changes planned](https://github.com/microsoft/vscode/issues/152399) to the VS Code authentication API to support this better, including the ability to list existing sessions. We could take this in one of two directions:

1. Keep the existing UX of being 'in' a particular tenant, but separate out the 'selection' logic from keeping track of which accounts/tenants are accessible (signed in). The new VS Code APIs might handle much/all of the latter.
2. Move towards a more stateless experience where the user is not expected to know/remember which account and tenant they are currently using. The Cloud Explorer tree view could be reworked to support this, by organizing it hierarchically as:
   ```
   - Provider (Azure)
     - Account (user@microsoft.com)
       - Tenant (e.g. 'Default Directory')
         - Subscription
           - Cluster
   ```
