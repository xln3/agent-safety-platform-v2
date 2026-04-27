import { FindOptions, Op } from 'sequelize';
import { JudgeModel } from '../models';
import { JudgeModelCreationAttributes } from '../models/JudgeModel';
import logger from '../utils/logger';

export const judgeModelService = {
  async findAll(
    page = 1,
    pageSize = 10,
    keyword?: string,
    extra?: Pick<FindOptions, 'attributes'>,
  ): Promise<{ rows: JudgeModel[]; count: number }> {
    const offset = (page - 1) * pageSize;
    const where: any = {};
    if (keyword && keyword.trim()) {
      where[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { modelId: { [Op.like]: `%${keyword}%` } },
        { description: { [Op.like]: `%${keyword}%` } },
      ];
    }
    const result = await JudgeModel.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [['createdAt', 'DESC']],
      ...extra,
    });
    return { rows: result.rows, count: result.count };
  },

  async findById(id: number, extra?: Pick<FindOptions, 'attributes'>): Promise<JudgeModel | null> {
    return JudgeModel.findByPk(id, extra);
  },

  async create(data: JudgeModelCreationAttributes): Promise<JudgeModel> {
    const judge = await JudgeModel.create(data);
    logger.info(`JudgeModel created: ${judge.id} - ${judge.name}`);
    return judge;
  },

  async update(id: number, data: Partial<JudgeModelCreationAttributes>): Promise<JudgeModel | null> {
    const judge = await JudgeModel.findByPk(id);
    if (!judge) return null;
    await judge.update(data);
    logger.info(`JudgeModel updated: ${judge.id} - ${judge.name}`);
    return judge;
  },

  async remove(id: number): Promise<boolean> {
    const judge = await JudgeModel.findByPk(id);
    if (!judge) return false;
    await judge.destroy();
    logger.info(`JudgeModel deleted: ${id}`);
    return true;
  },
};

export default judgeModelService;
