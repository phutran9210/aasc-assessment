import { BeforeInsert, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

export abstract class IntegrationBaseEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  protected assignUuidV7(): void {
    this.id ??= uuidv7();
  }
}
