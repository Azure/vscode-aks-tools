# AKS Fleet Manager

The extension allows you to create AKS Fleet Manager resources and visualize them in the tree view.

### Create an AKS Fleet Manager
- Right-click on the subscription where you want to create a Fleet.
- Choose **Fleet Manager**, then select **Create Fleet**.

![Right-click Navigation](../resources/aks-fleet-create-right-click.png)

A loading screen will appear while resource groups and locations are being retrieved. Once loaded, an input form will be displayed.

Complete all required fields marked with an asterisk (*). If any input is invalid, an error message will indicate the issue and guide you on how to fix it.

![Input Form](../resources/aks-fleet-create-input.png)

Once all required fields are filled with valid inputs, submit the form to create the Fleet resource. A loading screen will appear while the API processes the request.

Upon successful creation, a confirmation page will be shown, including a link to view the newly created Fleet in the Azure portal.
![On Success](../resources/aks-fleet-create-success.png)

If there is an error during creation, a failure page will be displayed with the error message from the API.
![On Failure](../resources/aks-fleet-create-failure.png)
