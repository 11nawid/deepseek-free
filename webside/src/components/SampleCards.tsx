"use client";
export default function SampleCards({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex justify-center items-center gap-4 my-12 perspective-1000">
      <Card 
        title="Retro Vibe"
        desc="Bold colors, funky fonts, and vintage cool."
        rotation="-rotate-6"
        colors={["bg-green-600", "bg-gray-800", "bg-orange-300", "bg-red-400"]}
        imgUrl="https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=300&auto=format&fit=crop"
        onClick={() => onSend("Retro Vibe: Bold colors, funky fonts, and vintage cool.")}
      />
      <Card 
        title="Soft & Dreamy"
        desc="Pastels, glow, and cloud-like calm."
        rotation="-rotate-2"
        colors={["bg-pink-300", "bg-purple-200", "bg-blue-200", "bg-yellow-100"]}
        imgUrl="https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?q=80&w=300&auto=format&fit=crop"
        translateY="translate-y-4"
        onClick={() => onSend("Soft & Dreamy: Pastels, glow, and cloud-like calm.")}
      />
      <Card 
        title="Earthy Tones"
        desc="Warm neutrals, natural textures, and calm vibes."
        rotation="rotate-2"
        colors={["bg-stone-600", "bg-yellow-900", "bg-orange-900", "bg-green-900"]}
        imgUrl="https://images.unsplash.com/photo-1618220179428-22790b461013?q=80&w=300&auto=format&fit=crop"
        translateY="translate-y-2"
        onClick={() => onSend("Earthy Tones: Warm neutrals, natural textures, and calm vibes.")}
      />
      <Card 
        title="Playful Pop"
        desc="Bright colors, bouncy shapes, and good energy."
        rotation="rotate-6"
        colors={["bg-blue-500", "bg-yellow-400", "bg-red-500", "bg-pink-500"]}
        imgUrl="https://images.unsplash.com/photo-1513364776144-60967b0f800f?q=80&w=300&auto=format&fit=crop"
        onClick={() => onSend("Playful Pop: Bright colors, bouncy shapes, and good energy.")}
      />
    </div>
  );
}

type CardProps = { title: string; desc: string; rotation: string; colors: string[]; imgUrl: string; translateY?: string; onClick: () => void; };

function Card({ title, desc, rotation, colors, imgUrl, translateY = "", onClick }: CardProps) {
  return (
    <div onClick={onClick} className={`w-48 bg-white rounded-2xl p-3 shadow-float flex flex-col gap-3 transition-transform hover:scale-105 hover:z-10 cursor-pointer ${rotation} ${translateY}`}>
      <div className="h-32 rounded-xl bg-gray-100 overflow-hidden">
        <img src={imgUrl} className="w-full h-full object-cover" alt={title} />
      </div>
      <div className="flex gap-1.5 px-1">
        {colors.map((c, i) => (
          <div key={i} className={`w-3 h-3 rounded-full ${c}`} />
        ))}
      </div>
      <div className="px-1 pb-1">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <p className="text-[10px] text-gray-500 leading-tight mt-1">{desc}</p>
      </div>
    </div>
  );
}
