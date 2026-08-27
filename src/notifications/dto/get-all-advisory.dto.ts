import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class GetAllAdvisoryDto {
  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'lang must be a 2-character ISO code (e.g. en, hi, gu)' })
  lang?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  state_code?: number;

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active_only?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /**
   * Number of records per page. Use limit=0 to return all records (no pagination).
   * Hard cap: 20,000 rows — suitable for full map renders.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20000)
  limit?: number = 100;
}
