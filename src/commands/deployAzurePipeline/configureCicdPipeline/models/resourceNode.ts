import { GenericResource } from 'azure-arm-resource/lib/resource/models';

export interface resourceNode{
    resource: GenericResource;
    subscriptionId: string;
}