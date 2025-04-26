import confetti from "canvas-confetti";
import { useState } from "react";
import { CoinchanAbi, CoinchanAddress } from "./constants/Coinchan";
import { useAccount, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import { pinImageToPinata, pinJsonToPinata } from "./utils/pinata";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import ImageInput from "./components/ui/image-input";

export function CoinForm({
  onMemepaperClick,
}: {
  onMemepaperClick: () => void;
}) {
  const [formState, setFormState] = useState({
    name: "",
    symbol: "",
    description: "",
    logo: "",
  });

  const [imageBuffer, setImageBuffer] = useState<ArrayBuffer | null>(null);
  const { address } = useAccount();

  const poolSupply = 21000000;
  const creatorSupply = 0;
  const swapFee = 100;
  const vestingDuration = 15778476;
  const vesting = true;

  const { writeContract, isPending, isSuccess, data } = useWriteContract();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!address || !imageBuffer) {
      console.error("Wallet not connected or image not uploaded");
      return;
    }

    console.log("Deploying coin with:", {
      ...formState,
      supply: poolSupply,
    });

    try {
      const fileName = `${formState.name}_logo.png`;
      const pinataMetadata = { name: fileName };

      const imageHash = await pinImageToPinata(
        imageBuffer,
        fileName,
        pinataMetadata,
      );

      const tokenUriJson = {
        name: formState.name,
        symbol: formState.symbol,
        description: formState.description,
        image: imageHash,
      };

      const tokenUriHash = await pinJsonToPinata(tokenUriJson);

      writeContract({
        address: CoinchanAddress,
        abi: CoinchanAbi,
        functionName: "makeLocked",
        value: parseEther("0.01"),
        args: [
          formState.name,
          formState.symbol,
          tokenUriHash,
          parseEther(poolSupply.toString()),
          parseEther(creatorSupply.toString()),
          BigInt(swapFee),
          address,
          BigInt(Math.floor(Date.now() / 1000) + vestingDuration),
          vesting,
        ],
      });

      confetti({
        particleCount: 666,
        spread: 666,
        scalar: 0.9,
        shapes: ["circle"],
        gravity: 0.9,
        colors: ["#f9bd20", "#c17a00", "#fff9e6"],
      });
    } catch (error) {
      console.error("Error deploying coin:", error);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFormState({
      ...formState,
      [e.target.name]: e.target.value,
    });
  };

  const handleFileChange = (value: File | File[] | undefined) => {
    if (value && !Array.isArray(value)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImageBuffer(e.target?.result as ArrayBuffer);
      };
      reader.readAsArrayBuffer(value);
    }
  };

  return (
    <div>
      <div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              name="name"
              value={formState.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              type="text"
              name="symbol"
              value={formState.symbol}
              onChange={handleChange}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              value={formState.description}
              onChange={handleChange}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo">Logo</Label>
            <ImageInput onChange={handleFileChange} />
          </div>

          <p>
            Read the{" "}
            <a href="#" onClick={onMemepaperClick}>
              coinpaper
            </a>{" "}
            to learn more.
          </p>

          <Button disabled={isPending} type="submit">
            {isPending ? "Check Wallet" : "Coin It!"}
          </Button>

          {isSuccess && <div>Transaction: {JSON.stringify(data)}</div>}
        </form>
      </div>
    </div>
  );
}
