import { JotformMappingError, toContactFields } from '../mappers/jotform-submission.mapper.js';
import type { JotformAnswer, JotformSubmissionContent } from '../types/index.js';

const submission = (answers: Record<string, JotformAnswer>): JotformSubmissionContent => ({
  id: '6001',
  form_id: '252770000000001',
  answers,
});

const FULL_NAME: JotformAnswer = {
  order: '1',
  type: 'control_fullname',
  answer: { first: 'Văn An', last: 'Nguyễn' },
  prettyFormat: 'Văn An Nguyễn',
};
const PHONE: JotformAnswer = {
  order: '2',
  type: 'control_phone',
  answer: { full: '(090) 123-4567' },
};
const EMAIL: JotformAnswer = { order: '3', type: 'control_email', answer: ' an@example.com ' };

describe('toContactFields', () => {
  it('should map the full name widget, phone and email', () => {
    expect(toContactFields(submission({ '3': FULL_NAME, '4': PHONE, '5': EMAIL }))).toEqual({
      name: 'Văn An Nguyễn',
      phone: '(090) 123-4567',
      email: 'an@example.com',
    });
  });

  it('should use the first text field as the name when there is no full name widget', () => {
    const fields = toContactFields(
      submission({
        '9': { order: '5', type: 'control_textbox', answer: 'Ghi chú' },
        '2': { order: '1', type: 'control_textbox', answer: '  Trần Thị Bình ' },
        '4': PHONE,
        '5': EMAIL,
      }),
    );
    expect(fields.name).toBe('Trần Thị Bình');
  });

  it('should include the middle name', () => {
    const fields = toContactFields(
      submission({
        '3': {
          order: '1',
          type: 'control_fullname',
          answer: { first: 'Lê', middle: 'Hoàng', last: 'Cường' },
        },
        '4': PHONE,
        '5': EMAIL,
      }),
    );
    expect(fields.name).toBe('Lê Hoàng Cường');
  });

  it.each([
    ['full number', { full: '+84 90 123 4567' }, '+84 90 123 4567'],
    ['area and number', { area: '090', phone: '1234567' }, '090 1234567'],
    ['country, area and number', { country: '84', area: '90', phone: '1234567' }, '+84 90 1234567'],
    ['plain string', '0901234567', '0901234567'],
  ])('should read a phone given as %s', (_label, answer, expected) => {
    const fields = toContactFields(
      submission({
        '3': FULL_NAME,
        '4': { order: '2', type: 'control_phone', answer },
        '5': EMAIL,
      }),
    );
    expect(fields.phone).toBe(expected);
  });

  it('should fall back to prettyFormat when the phone answer is empty', () => {
    const fields = toContactFields(
      submission({
        '3': FULL_NAME,
        '4': { order: '2', type: 'control_phone', answer: {}, prettyFormat: '090 123 4567' },
        '5': EMAIL,
      }),
    );
    expect(fields.phone).toBe('090 123 4567');
  });

  it('should report every invalid field at once', () => {
    const run = () =>
      toContactFields(
        submission({
          '4': { order: '2', type: 'control_phone', answer: { full: 'abc' } },
          '5': { order: '3', type: 'control_email', answer: 'not-an-email' },
        }),
      );

    expect(run).toThrow(JotformMappingError);
    try {
      run();
    } catch (error) {
      expect((error as JotformMappingError).problems).toEqual([
        'Họ và tên trống hoặc dài quá 255 ký tự',
        'Số điện thoại không hợp lệ',
        'Email không hợp lệ',
      ]);
    }
  });

  it('should reject a submission without answers', () => {
    expect(() => toContactFields({ id: '1', form_id: '2' })).toThrow(JotformMappingError);
  });
});
