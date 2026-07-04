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

describe('PancakeApiService — multi-platform PANCAKE_PAGE_TOKENS', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  const pageTokens: Record<string, string> = {
    '331141913426390': 'token-facebook',
    th_34492698423663089: 'token-threads',
    'ttm_-000Aun5XmhaIsXLrqYagVcxB3C9ftQFwPd0': 'token-tiktok',
    zl_4106960317200585113: 'token-zalo',
    igo_17841478113496516: 'token-instagram',
  };

  beforeEach(() => {
    process.env.PANCAKE_PAGE_TOKENS = JSON.stringify(pageTokens);
    delete process.env.PANCAKE_PAGE_ID;
    delete process.env.PANCAKE_PAGE_ACCESS_TOKEN;

    mockedAxios.create = jest.fn().mockReturnValue({
      post: jest.fn().mockResolvedValue({ data: { success: true } }),
      get: jest.fn(),
    } as any);
  });

  afterEach(() => {
    delete process.env.PANCAKE_PAGE_TOKENS;
    jest.restoreAllMocks();
  });

  it('resolves the correct page_access_token independently for each configured platform page', async () => {
    const service = new PancakeApiService();

    for (const [pageId, token] of Object.entries(pageTokens)) {
      await service.markRead(pageId, 'conv-1');

      const lastCall = (mockedAxios.create as jest.Mock).mock.calls.at(-1)[0];
      expect(lastCall.params).toEqual({ page_access_token: token });
    }
  });

  it('warns and sends no token for a page not present in PANCAKE_PAGE_TOKENS', async () => {
    const service = new PancakeApiService();

    await service.markRead('unknown-page-id', 'conv-1');

    const lastCall = (mockedAxios.create as jest.Mock).mock.calls.at(-1)[0];
    expect(lastCall.params).toEqual({});
  });
});
