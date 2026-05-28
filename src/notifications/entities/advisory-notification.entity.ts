import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('advisory_notifications')
export class AdvisoryNotification {
  @PrimaryGeneratedColumn('uuid', { name: 'message_id' })
  messageId: string;

  @Index()
  @Column({ name: 'unique_id_pm_kisan', type: 'integer' })
  uniqueIdPmKisan: number;

  @Index()
  @Column({ name: 'unique_id_iitm', type: 'bigint' })
  uniqueIdIitm: string;

  @Index()
  @Column({ name: 'subdistrict_code', type: 'integer' })
  subdistrictCode: number;

  @Column({ name: 'subdistrict_name', type: 'varchar', length: 100, nullable: true })
  subdistrictName: string | null;

  @Index()
  @Column({ name: 'district_code', type: 'integer' })
  districtCode: number;

  @Column({ name: 'district_name', type: 'varchar', length: 100, nullable: true })
  districtName: string | null;

  @Index()
  @Column({ name: 'state_code', type: 'integer' })
  stateCode: number;

  @Column({ name: 'state_name', type: 'varchar', length: 100, nullable: true })
  stateName: string | null;

  @Index()
  @Column({ name: 'lang_abb', type: 'char', length: 3 })
  langAbb: string;

  @Column({ name: 'forecast_message', type: 'text', nullable: true })
  forecastMessage: string | null;

  @Column({ name: 'template_abbreviation', type: 'varchar', length: 50, nullable: true })
  templateAbbreviation: string | null;

  @Index()
  @Column({ name: 'from_date', type: 'date' })
  fromDate: string;

  @Index()
  @Column({ name: 'to_date', type: 'date' })
  toDate: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
