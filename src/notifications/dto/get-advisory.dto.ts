import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class GetAdvisoryDto {
  @IsOptional()
  @IsString()
  @Length(20, 64, { message: 'visitor_id must be a valid FingerprintJS visitorId' })
  visitor_id?: string;

  @IsNumber({}, { message: 'lat must be a number' })
  @Min(-90,  { message: 'lat must be >= -90' })
  @Max(90,   { message: 'lat must be <= 90' })
  lat: number;

  @IsNumber({}, { message: 'lon must be a number' })
  @Min(-180, { message: 'lon must be >= -180' })
  @Max(180,  { message: 'lon must be <= 180' })
  lon: number;

  @IsString()
  @Length(2, 2, { message: 'lang must be a 2-character ISO code (e.g. en, hi, gu)' })
  lang: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'each seen_message_id must be a valid UUID v4' })
  seen_message_ids?: string[];
}
