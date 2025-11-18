import axios from "axios";

export interface MoneroRpcConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface CreateAddressResponse {
  address: string;
  address_index: number;
}

export interface Transfer {
  address: string;
  amount: number;
  confirmations: number;
  height: number;
  subaddr_index: {
    major: number;
    minor: number;
  };
  timestamp: number;
  txid: string;
  unlock_time: number;
}

export interface GetTransfersResponse {
  in?: Transfer[];
}

export class MoneroRpcClient {
  private baseUrl: string;
  private auth?: { username: string; password: string };

  constructor(config: MoneroRpcConfig) {
    this.baseUrl = `http://${config.host}:${config.port}/json_rpc`;
    if (config.username && config.password) {
      this.auth = { username: config.username, password: config.password };
    }
  }

  private async call(method: string, params: any = {}): Promise<any> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          jsonrpc: "2.0",
          id: "0",
          method,
          params,
        },
        {
          auth: this.auth,
          timeout: 30000,
        }
      );

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`RPC request failed: ${error.response.status} ${error.response.statusText}`);
      }
      throw new Error(`RPC request failed: ${error.message}`);
    }
  }

  // Create new subaddress
  async createAddress(accountIndex: number, label?: string): Promise<CreateAddressResponse> {
    const result = await this.call("create_address", {
      account_index: accountIndex,
      label,
    });

    return {
      address: result.address,
      address_index: result.address_index,
    };
  }

  // Get incoming transfers
  async getTransfers(
    accountIndex: number,
    minHeight?: number,
    subaddrIndices?: number[]
  ): Promise<GetTransfersResponse> {
    const params: any = {
      in: true,
      account_index: accountIndex,
    };

    if (minHeight !== undefined) {
      params.min_height = minHeight;
    }

    if (subaddrIndices && subaddrIndices.length > 0) {
      params.subaddr_indices = subaddrIndices;
    }

    return await this.call("get_transfers", params);
  }

  // Get wallet height (current sync status)
  async getHeight(): Promise<number> {
    const result = await this.call("get_height");
    return result.height;
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      await this.getHeight();
      return true;
    } catch {
      return false;
    }
  }
}
