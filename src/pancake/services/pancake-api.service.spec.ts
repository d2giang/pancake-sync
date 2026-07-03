import axios from 'axios';
import { PancakeApiService } from './pancake-api.service';

jest.mock('axios');

describe('PancakeApiService — Page Access Token auth', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  let postMock: jest.Mock;

  beforeEach(() => {
    process.env.PANCAKE_PAGE_ID = 'page-1';
    process.env.PANCAKE_PAGE_ACCESS_TOKEN = 'test-page-token';
    delete process.env.PANCAKE_PAGE_TOKENS;

    postMock = jest.fn().mockResolvedValue({ data: { success: true } });
    mockedAxios.create = jest.fn().mockReturnValue({
      post: postMock,
      get: jest.fn(),
    } as any);
  });

  afterEach(() => {
    delete process.env.PANCAKE_PAGE_ID;
    delete process.env.PANCAKE_PAGE_ACCESS_TOKEN;
    jest.restoreAllMocks();
  });

  it('sends the Page Access Token as the page_access_token query param, not access_token or Authorization Bearer', async () => {
    const service = new PancakeApiService();

    await service.sendMessage('page-1', 'conv-1', { message: 'hi' });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { page_access_token: 'test-page-token' },
      }),
    );

    const createArgs = (mockedAxios.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.params.access_token).toBeUndefined();
    expect(createArgs.headers.Authorization).toBeUndefined();
  });
});
