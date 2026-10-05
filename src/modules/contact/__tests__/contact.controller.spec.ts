import { Test } from '@nestjs/testing';
import { AuthService } from '@modules/auth/services/auth.service.js';

import { ContactController } from '../controllers/contact.controller.js';
import { ContactService } from '../services/contact.service.js';

describe('ContactController', () => {
  const service = { findAll: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  let controller: ContactController;
  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ContactController],
      providers: [
        { provide: ContactService, useValue: service },
        { provide: AuthService, useValue: { verifyToken: jest.fn() } },
      ],
    }).compile();
    controller = moduleRef.get(ContactController);
  });
  it('should delegate GET query to ContactService', async () => {
    service.findAll.mockResolvedValue({ data: [], meta: {} });
    await controller.findAll({ page: 1, limit: 10 });
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
  });
  it('should return 201 for a valid create request', async () => {
    service.create.mockResolvedValue({ id: '1' });
    await expect(controller.create({ name: 'A' })).resolves.toEqual({ id: '1' });
  });
  it('should delegate PUT id and DTO', async () => {
    service.update.mockResolvedValue({ id: '1' });
    await controller.update(1, { name: 'A' });
    expect(service.update).toHaveBeenCalledWith('1', { name: 'A' });
  });
  it('should return no content after delete', async () => {
    await controller.remove(1);
    expect(service.remove).toHaveBeenCalledWith('1');
  });
});
