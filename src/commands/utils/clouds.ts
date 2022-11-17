import AksClusterTreeItem from "../../tree/aksClusterTreeItem";
import { Errorable } from "./errorable";

export interface Cloud {
    name: string,
    aadEndpoint: string,
    armEndpoint: string,
    portalEndpoint: string,
    isPeriscopeSupported: boolean
}

export const PublicCloud: Cloud = {
    name: "public",
    aadEndpoint: "https://login.microsoftonline.com",
    armEndpoint: "https://management.azure.com",
    portalEndpoint: "https://portal.azure.com",
    isPeriscopeSupported: true
}

export const UsGovCloud: Cloud = {
    name: "usgov",
    aadEndpoint: "https://login.microsoftonline.us",
    armEndpoint: "https://management.usgovcloudapi.net",
    portalEndpoint: "https://portal.azure.us",
    isPeriscopeSupported: false
}

export function getCloud(target: AksClusterTreeItem): Errorable<Cloud> {
    const location = target.resource.location;

    if (location && location.includes("usgov")) {
        return { succeeded: true, result: UsGovCloud };
    }

    return { succeeded: true, result: PublicCloud };
}
