import * as configureStarterWorkflow  from '../../commands/aksStarterWorkflow/configureStarterWorkflowHelper';
import 'sinon';
import { expect } from 'chai';

describe('Test Configure Starter Data Set returns replaced value.', () => {
  it('should return some string', () => {
    const result = configureStarterWorkflow.configureStarterConfigDataForAKS("test-resource", "test-cluster");
    expect(result).to.contain("test-cluster");
  });
});
