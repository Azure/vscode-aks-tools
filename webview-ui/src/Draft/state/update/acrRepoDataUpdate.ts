import { newLoaded, newLoading } from "../../../utilities/lazy";
import { RepositoryReferenceData } from "../stateTypes";

export function setTagsLoading(data: RepositoryReferenceData): RepositoryReferenceData {
    return { ...data, tags: newLoading() };
}

export function updateTags(data: RepositoryReferenceData, tags: string[]): RepositoryReferenceData {
    return {
        ...data,
        tags: newLoaded(tags),
    };
}
