import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from "react";

export function Card({
  children,
  style,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return (
    <section
      {...props}
      style={{
        ...style,
        background: "#0b1519",
        border: "1px solid #173039",
        borderRadius: 18,
        padding: 18,
        boxShadow: "0 16px 45px rgba(0,0,0,.18)"
      }}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  return <h2 style={{ margin: "0 0 10px", fontSize: "1rem", letterSpacing: ".02em" }}>{children}</h2>;
}

export function Badge({ children }: PropsWithChildren) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 28,
        padding: "4px 9px",
        border: "1px solid #2d655c",
        borderRadius: 999,
        color: "#a6efe0",
        background: "#0b211f",
        fontSize: ".72rem",
        fontWeight: 800,
        letterSpacing: ".05em"
      }}
    >
      {children}
    </span>
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      style={{
        border: "1px solid #3b776c",
        borderRadius: 10,
        padding: "9px 12px",
        color: "#07120f",
        background: props.disabled ? "#51605d" : "#7fd9c5",
        fontWeight: 800,
        opacity: props.disabled ? .65 : 1
      }}
    />
  );
}
