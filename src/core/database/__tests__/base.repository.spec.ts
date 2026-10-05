import { Column, DataSource, Entity } from 'typeorm';
import { validate as isUuid, version as uuidVersion } from 'uuid';

import { BaseEntity } from '../entities/base.entity.js';
import { BaseRepository } from '../repositories/base.repository.js';

@Entity('widget')
class Widget extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  name: string;
}

class WidgetRepository extends BaseRepository<Widget> {
  constructor(dataSource: DataSource) {
    super(dataSource, Widget);
  }
}

describe('BaseRepository + BaseEntity', () => {
  let dataSource: DataSource;
  let repository: WidgetRepository;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Widget],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = new WidgetRepository(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  describe('create', () => {
    it('should generate a UUID v7 id and timestamps when an entity is created', async () => {
      const widget = await repository.create({ name: 'first' });

      expect(isUuid(widget.id)).toBe(true);
      expect(uuidVersion(widget.id)).toBe(7);
      expect(widget.createdAt).toBeInstanceOf(Date);
      expect(widget.updatedAt).toBeInstanceOf(Date);
    });

    it('should keep the given id when the caller provides one', async () => {
      const id = '0199a1b2-c3d4-7e5f-8a6b-0123456789ab';

      const widget = await repository.create({ id, name: 'fixed' });

      expect(widget.id).toBe(id);
    });

    it('should generate ids that sort by creation order when created in sequence', async () => {
      const first = await repository.create({ name: 'a' });
      const second = await repository.create({ name: 'b' });

      expect(first.id < second.id).toBe(true);
    });
  });

  describe('findById', () => {
    it('should return the entity when it exists', async () => {
      const created = await repository.create({ name: 'find-me' });

      const found = await repository.findById(created.id);

      expect(found).toEqual(expect.objectContaining({ id: created.id, name: 'find-me' }));
    });

    it('should return null when no entity has that id', async () => {
      expect(await repository.findById('missing')).toBeNull();
    });
  });

  describe('save', () => {
    it('should persist changes when an existing entity is saved', async () => {
      const widget = await repository.create({ name: 'old' });
      widget.name = 'new';

      await repository.save(widget);

      expect((await repository.findById(widget.id))?.name).toBe('new');
    });
  });

  describe('remove', () => {
    it('should delete the row when an entity is removed', async () => {
      const widget = await repository.create({ name: 'gone' });
      const { id } = widget;

      await repository.remove(widget);

      expect(await repository.findById(id)).toBeNull();
    });
  });
});
