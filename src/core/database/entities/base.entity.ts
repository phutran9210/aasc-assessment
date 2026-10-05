import { BeforeInsert, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

/** Columns shared by every table: time-sortable UUID v7 id and audit timestamps. */
export abstract class BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  protected generateId(): void {
    if (!this.id) this.id = uuidv7();
  }
}
