import { Schema } from 'effect';
import { JinaKey } from '../entity/setting/fetcher';

export const JinaKeyInput = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2048), Schema.isPattern(/^[^\r\n]*$/)),
  Schema.decodeTo(JinaKey)
);

export const JinaKeyUpdate = Schema.UndefinedOr(JinaKeyInput);
