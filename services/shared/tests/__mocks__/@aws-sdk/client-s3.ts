export const mockSend = jest.fn().mockResolvedValue({});

export const S3Client = jest.fn().mockImplementation(() => ({
  send: mockSend,
}));

export const PutObjectCommand = jest.fn().mockImplementation((input) => input);
export const GetObjectCommand = jest.fn().mockImplementation((input) => input);
