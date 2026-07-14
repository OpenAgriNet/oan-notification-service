import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('generic_messages')
export class GenericMessage {
  @PrimaryGeneratedColumn('uuid', { name: 'message_id' })
  messageId: string;

  @Column({ name: 'message_type', type: 'varchar', length: 50, default: 'generic' })
  messageType: string;

  @Column({ name: 'category_type', type: 'varchar', length: 50, nullable: true })
  categoryType: string | null;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Index()
  @Column({ name: 'lang_abb', type: 'char', length: 3 })
  langAbb: string;

  @Index()
  @Column({ name: 'from_date', type: 'date' })
  fromDate: string;

  @Index()
  @Column({ name: 'to_date', type: 'date' })
  toDate: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
