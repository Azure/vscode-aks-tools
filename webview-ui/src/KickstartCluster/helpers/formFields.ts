import * as l10n from "@vscode/l10n";
import { Validatable, invalid, missing, valid } from "../../utilities/validation";

// AKS auto-generates the node resource group as MC_<rg>_<cluster>_<location>. Azure caps that name at
// 80 characters. We supply a truncated name at deploy time (see generateNodeResourceGroup in
// ClusterSpecCreationBuilder) so it never fails preflight, but we also warn here so the user can pick
// shorter names up front instead of getting a silently truncated node resource group.
export const MAX_NODE_RESOURCE_GROUP_LENGTH = 80;

export function getValidatedClusterName(value: string): Validatable<string> {
    if (!value) return missing<string>(l10n.t("Cluster name is required."));
    if (value.length > 63) return invalid(value, l10n.t("Cluster name must be at most 63 characters long."));
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/.test(value)) {
        return invalid(
            value,
            l10n.t(
                "Only letters, numbers, dashes, and underscores are allowed. The first and last character must be a letter or number.",
            ),
        );
    }
    return valid(value);
}

export function getValidatedAcrName(value: string): Validatable<string> {
    if (!value) return missing<string>(l10n.t("Registry name is required."));
    if (!/^[a-zA-Z0-9]{5,50}$/.test(value)) {
        return invalid(value, l10n.t("Registry name must be 5-50 alphanumeric characters (no dashes)."));
    }
    return valid(value);
}

export function getValidatedRgName(value: string): Validatable<string> {
    if (!value) return missing<string>(l10n.t("Resource group name is required."));
    if (value.length > 90) return invalid(value, l10n.t("Resource group name must be at most 90 characters."));
    if (!/^[-\w._()]+$/.test(value) || value.endsWith(".")) {
        return invalid(value, l10n.t("Resource group name contains invalid characters."));
    }
    return valid(value);
}

export function getNodeResourceGroupName(resourceGroupName: string, clusterName: string, location: string): string {
    return `MC_${resourceGroupName}_${clusterName}_${location}`;
}

export function randomSuffix(length: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
}

export function deriveClusterName(resourceGroupName: string, suffix: string): string {
    const base = resourceGroupName.replace(/[^a-zA-Z0-9_-]/g, "").replace(/^[-_]+|[-_]+$/g, "") || "aks";
    if (!suffix) return base.slice(0, 63).replace(/[-_]+$/g, "");
    return `${base.slice(0, 63 - suffix.length - 1)}-${suffix}`;
}

export function deriveAcrName(resourceGroupName: string, suffix: string): string {
    const base = resourceGroupName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "acr";
    return `${base.slice(0, 50 - suffix.length)}${suffix}`;
}

export function toBaseName(appName: string): string {
    return appName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
