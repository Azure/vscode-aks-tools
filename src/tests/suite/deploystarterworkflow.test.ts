import * as deployStarterWorkflow  from '../../commands/aksStarterWorkflow/deployStarterWorkflowHelper';
import 'sinon';
import { expect } from 'chai';

describe('Test Configure Starter Data Set returns replaced value.', () => {
  it('should return some string', () => {
    const result = deployStarterWorkflow.configureStarterConfigDataForAKS("test-resource", "test-cluster");
    expect(result).to.contain("test-cluster");
  });
});
