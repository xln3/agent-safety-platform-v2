import { FindOptions, Op } from 'sequelize';
import { Agent } from '../models';
import { AgentCreationAttributes } from '../models/Agent';
import logger from '../utils/logger';

export const agentService = {
  async findAll(
    page: number = 1,
    pageSize: number = 10,
    keyword?: string,
    extra?: Pick<FindOptions, 'attributes'>
  ): Promise<{ rows: Agent[]; count: number }> {
    const offset = (page - 1) * pageSize;
    const where: any = {
      status: { [Op.ne]: 'deleted' },
    };

    if (keyword && keyword.trim()) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { description: { [Op.like]: `%${keyword}%` } },
        { modelId: { [Op.like]: `%${keyword}%` } },
      ];
    }

    const result = await Agent.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [['createdAt', 'DESC']],
      ...extra,
    });

    return { rows: result.rows, count: result.count };
  },

  async findById(id: number, extra?: Pick<FindOptions, 'attributes'>): Promise<Agent | null> {
    return Agent.findOne({
      where: { id, status: { [Op.ne]: 'deleted' } },
      ...extra,
    });
  },

  async create(data: AgentCreationAttributes): Promise<Agent> {
    const agent = await Agent.create(data);
    logger.info(`Agent created: ${agent.id} - ${agent.name}`);
    return agent;
  },

  async update(id: number, data: Partial<AgentCreationAttributes>): Promise<Agent | null> {
    const agent = await Agent.findOne({
      where: { id, status: { [Op.ne]: 'deleted' } },
    });

    if (!agent) {
      return null;
    }

    await agent.update(data);
    logger.info(`Agent updated: ${agent.id} - ${agent.name}`);
    return agent;
  },

  async remove(id: number): Promise<boolean> {
    const agent = await Agent.findByPk(id);
    if (!agent) {
      return false;
    }

    await agent.update({ status: 'deleted' });
    logger.info(`Agent soft-deleted: ${id}`);
    return true;
  },
};

export default agentService;
