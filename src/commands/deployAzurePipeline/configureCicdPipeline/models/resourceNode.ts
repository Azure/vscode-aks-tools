import { GenericResource } from 'azure-arm-resource/lib/resource/models';

export interface resourceNode extends GenericResource{
    resource: GenericResource;
    subscriptionId: string;
}