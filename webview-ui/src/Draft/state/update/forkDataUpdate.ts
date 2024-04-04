import { newLoaded, newLoading } from "../../../utilities/lazy";
import { ForkReferenceData } from "../stateTypes";

export function setBranchesLoading(data: ForkReferenceData): ForkReferenceData {
    return {
        ...data,
        branches: newLoading(),
    };
}

export function updateBranches(data: ForkReferenceData, branches: string[]): ForkReferenceData {
    return {
        ...data,
        branches: newLoaded(branches),
    };
}
