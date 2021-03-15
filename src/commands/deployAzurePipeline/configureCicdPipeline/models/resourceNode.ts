import { GenericResource } from '@azure/arm-resources/esm/models';

export interface resourceNode{
    resource: GenericResource;
    subscriptionId: string;
}