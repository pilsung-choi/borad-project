import { BadRequestException, Injectable } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { PagePaginationDto } from './dto/page-pagenation.dto';
import { CursorPaginationDto } from './dto/cursor-page-pagination.dto';

@Injectable()
export class CommonService {
  constructor() {}

  applyPagePaginationParamsToQb<T>(
    qb: SelectQueryBuilder<T>,
    dto: PagePaginationDto,
  ) {
    const { take, page } = dto;
    const skip = (page - 1) * take;

    qb.skip(skip);
    qb.take(take);
  }

  async applyCursorPaginationParamsToQb<T>(
    qb: SelectQueryBuilder<T>,
    dto: CursorPaginationDto,
  ) {
    let { cursor, take, order } = dto;

    if (cursor) {
      const decodesCursor = Buffer.from(cursor, 'base64').toString('utf-8');
      const cursorObj = JSON.parse(decodesCursor);

      // cursorObj의 value와 order
      /**
       * {value:
       *    {
       *      likeCount:20,
       *      id:35
       * },
       *  order:
       *      ["likeCount_DESC", "id_DESC"]
       * }
       * -----------------
       * {  "value":
       *         {"id":4}
       * ,
       *    "order":
       *         ["id_DESC"]
       * }
       */

      order = cursorObj.order;

      const values = cursorObj.value;

      // WHERE (column1 > value1)
      // OR (column1 = value1 AND column2 > value2)
      // OR (column1 = value1 AND column2 = value2 AND column3 > value3)
      // 같은 쿼리다
      // (column1, column2, column3) > (value1, value2, value3)
      const columns = Object.keys(values);
      const comparisonOperators = order.some((o) => o.endsWith('DESC'))
        ? '<'
        : '>';
      const whereConditions = columns.map((c) => `${qb.alias}.${c}`).join(', ');
      const whereParams = columns.map((c) => `:${c}`).join(', ');

      qb.where(
        `(${whereConditions}) ${comparisonOperators} (${whereParams})`,
        values,
      );
    }

    // [likeCount_DESC,id_DESC]
    for (let i = 0; i < order.length; i++) {
      const [column, direction] = order[i].split('_');

      if (direction !== 'ASC' && direction !== 'DESC') {
        throw new BadRequestException('Order는 ASC 또는 DESC만 가능합니다.');
      }

      if (i === 0) {
        qb.orderBy(`${qb.alias}.${column}`, direction);
      } else {
        qb.addOrderBy(`${qb.alias}.${column}`, direction);
      }
    }

    qb.take(take);

    const results = await qb.getMany();

    const nextCursor = this.generateNextCursor(results, order);

    return { qb, nextCursor };
  }

  generateNextCursor<T>(results: T[], order: string[]): string | null {
    if (results.length === 0) {
      return null;
    }
    /**
     * {
     * values: {
     *   id: 52
     * },
     *  order: ['id_DESC']
     * }
     */

    const lastItem = results[results.length - 1];

    const value = {};

    order.forEach((columnOrder) => {
      const [column] = columnOrder.split('_');
      value[column] = lastItem[column];
    });

    const cursorObj = { value, order };

    const nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString(
      'base64',
    );

    return nextCursor;
  }
}
